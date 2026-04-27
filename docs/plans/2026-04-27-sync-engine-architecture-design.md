# PazarSync — Sync Engine Architecture (v2)

> Design spec for the platform-wide background sync engine. Supersedes the
> v1.0 fire-and-forget Promise model used for products sync. Drives a
> separate implementation plan (forthcoming).

## 1. Context

The current sync execution path — `runInBackground(productSyncService.run(...))`
inside the Hono request handler — was the v1.0 expedient for the products-sync
MVP. It works for one-off catalog refreshes but has three structural problems
that make it unfit as the foundation for the broader platform:

1. **Sync lifetime tied to API process lifetime.** Hot reload, deploy, OOM
   kill, or any process restart kills in-flight syncs. The SyncLog row stays
   `RUNNING`; `cleanupStaleRunning` reaps after 10 min as
   `FAILED ('SYNC_TIMEOUT')`. No automatic resume.
2. **No execution checkpoint.** `progressCurrent` (record count) is durable
   but the page cursor (Trendyol's `page` index or `nextPageToken`) lives in
   the async-generator's heap state. A worker that crashes can't be replaced
   because nothing knows where to resume.
3. **Subscription scoped to the products page.** SyncCenter mounts inside
   `/products` only. Other org users on different routes have no Realtime
   channel open and miss sync events entirely.

These are bearable while sync is one click → one product refresh. They become
structural debt the moment the platform expands to continuous order ingest,
settlement reconciliation, and customer-message sync across multiple
marketplaces.

## 2. Target behavior

1. **Trigger** — any user belonging to an organization can start a sync.
2. **Real-time visibility across the org** — any other org member currently
   active anywhere in the dashboard sees the sync start and progress live,
   the same way the triggering user sees it.
3. **Background durability** — the sync runs server-side. Page refresh,
   navigation, tab close, browser kill, API process restart, deploy, hot
   reload — none interrupt or restart the sync.
4. **Cancel** — explicitly out of scope for this design; will be a follow-up.

## 3. Workload profile

Order-of-magnitude estimate for sustained multi-module load (1k sellers,
all modules live):

| Module      | Cadence            | Chunks/day per store | Chunks/day total |
| ----------- | ------------------ | -------------------- | ---------------- |
| Products    | 1×/day full+delta  | ~5–50                | ~25k             |
| Orders      | every 1–5 min      | ~300–1400            | ~700k            |
| Settlements | daily/weekly       | ~1                   | ~1k              |
| Messages    | every 1–5 min      | ~300–1400            | ~700k            |
| **Total**   |                    |                      | **~1.4M / day**  |

≈ **15 chunk dispatches / second steady-state** with bursts at peak shopping
hours and after marketplace outages clear. Each chunk is a 5–30 s unit of
work (one marketplace page + its upserts in a single Postgres transaction).

This is real queue + worker territory, not "fire-and-forget on a request
handler."

## 4. Decisions (locked)

| Decision                  | Choice                                                     | Why                                                                                                                              |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Execution environment     | Dedicated Node worker (`apps/sync-worker/`)                | Code locality with API (single TS codebase, same Prisma, same Vitest). Independent deploy + scale. Avoids Deno port tax of Edge. |
| Queue substrate (v1)      | SyncLog row IS the queue ("D1")                            | One source of truth for both worker dispatch and user-facing observation. No new tables. Promotes cleanly to pgmq when needed.   |
| Worker discovery          | Pure polling, adaptive backoff (100 ms active → 5 s idle)  | Simpler than `pg_notify`. ~1 s p50 trigger latency acceptable for sync UX. `pg_notify` deferred to v2.                           |
| Concurrency control       | Partial unique index on `(storeId, syncType)` active slots | Atomic. Replaces ~30 lines of "INSERT then race-detect" code in `acquireSlot`. Two clicks → one INSERT, the other gets P2002.   |
| Per-row claim             | `SELECT … FOR UPDATE SKIP LOCKED`                          | Multi-worker cooperation without coordination. Whoever loses the race goes to the next row.                                      |
| Claim model               | One-claim-many-chunks                                      | Worker holds the row through the run. Chunks are for resumability, not load-balancing. Scale by adding workers, not by re-claim. |
| Subscription scope        | Org-wide (`organization_id=eq.<orgId>`)                    | Single channel per user. Any sync in any store the user can see surfaces in their dashboard. Matches requirement (2) literally.  |
| Subscription mount point  | Dashboard layout (`(dashboard)/layout.tsx`)                | Every authenticated dashboard route inherits the channel. SyncBadge in the header lights up regardless of which page is active.  |

## 5. Architecture overview

```
Browser              Hono API           Postgres            sync-worker
  │                    │                  │                   │
  │ POST /sync         │                  │                   │
  │ ─────────────────► │ INSERT PENDING   │                   │
  │                    │ ────────────────►│                   │
  │ 202 { syncLogId }  │                  │                   │
  │ ◄───────────────── │                  │                   │
  │                    │                  │  tryClaim()      │
  │                    │                  │ ◄─────────────── │
  │                    │                  │  UPDATE RUNNING   │
  │                    │                  │ ───────────────► │
  │                    │                  │                   │
  │                    │                  │  ┌── chunk loop ──┤
  │                    │                  │  │ fetch page     │
  │                    │                  │  │ upsert in tx   │
  │                    │                  │  │ tick(cursor)   │
  │ Realtime UPDATE    │                  │  │ ──────────────►│
  │ ◄──────────────────────────────────── │ ◄┘                │
  │                    │                  │                   │
  │  ... loop until last page ...         │                   │
  │                    │                  │  complete()       │
  │                    │                  │ ◄──────────────── │
  │ Realtime UPDATE    │                  │                   │
  │ ◄──────────────────────────────────── │                   │
```

Key principles encoded above:

- **API never executes work.** It only writes intent (`INSERT PENDING`) and
  returns 202.
- **Worker never serves user requests.** Pure pull-model from Postgres.
- **All state lives in Postgres.** No in-memory job state on the API or the
  worker. Restart any process at any time → resumes from last `tick()`.
- **Realtime is the observation channel.** Postgres logical decoding ⇒
  Supabase Realtime ⇒ all subscribed dashboards. No client polling.

## 6. Section 1 — Queue model (SyncLog as queue, D1)

### Lifecycle states

```
              ┌─ COMPLETED       (terminal, success)
PENDING ─► RUNNING ─┤
              ├─ FAILED          (terminal, permanent — bad creds, malformed config)
              └─ FAILED_RETRYABLE ──(after backoff)──► PENDING
```

`PENDING` and `FAILED_RETRYABLE` are new. `RUNNING` / `COMPLETED` / `FAILED`
already exist on the current enum.

### New columns on `sync_logs`

| Column          | Type        | Purpose                                                                                              |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `claimedAt`     | timestamptz | When a worker took ownership. NULL while `PENDING`.                                                  |
| `claimedBy`     | text        | Worker process id (e.g. `worker-i7q2`). Ops debugging only.                                          |
| `lastTickAt`    | timestamptz | Heartbeat — worker writes on every chunk completion.                                                 |
| `pageCursor`    | jsonb       | Pagination state. `{kind:'page', n:12}` or `{kind:'token', token:'...'}`. Schema varies per module.  |
| `attemptCount`  | int (def 0) | How many attempts so far (retry-budget gate).                                                        |
| `nextAttemptAt` | timestamptz | When a `FAILED_RETRYABLE` row becomes claimable again.                                               |

`pageCursor` is JSONB to stay generic across modules (orders/messages have
different cursor shapes). Application layer enforces typing via Zod parsers
per module.

### Atomic dedup at the data layer

```sql
CREATE UNIQUE INDEX sync_logs_active_slot_uniq
  ON sync_logs (store_id, sync_type)
  WHERE status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE');
```

Postgres atomically guarantees one active slot per `(storeId, syncType)`.
Concurrent enqueues → one wins via `INSERT`, the loser gets `23505` →
mapped to `SyncInProgressError(409)` with `meta.existingSyncLogId` so the
UI can navigate to the live run.

### Atomic worker claim

```sql
UPDATE sync_logs SET
  status = 'RUNNING',
  claimedAt = now(),
  claimedBy = $worker_id,
  lastTickAt = now(),
  attemptCount = attemptCount + 1
WHERE id = (
  SELECT id FROM sync_logs
   WHERE (status = 'PENDING')
      OR (status = 'FAILED_RETRYABLE' AND nextAttemptAt <= now())
   ORDER BY startedAt
   FOR UPDATE SKIP LOCKED
   LIMIT 1
)
RETURNING *;
```

`SKIP LOCKED` lets multiple workers cooperate without coordination. No
worker ever blocks another; whoever loses the race looks at the next row.

### Stale-claim watchdog

A periodic sweep (in-worker, every 30 s) requeues rows whose holder died:

```sql
UPDATE sync_logs SET status = 'PENDING', claimedAt = NULL, claimedBy = NULL
WHERE status = 'RUNNING' AND lastTickAt < now() - interval '90 seconds';
```

90 s is generous — chunk p99 is ~30 s, plus retry budget, plus margin.

### UI mapping

- `PENDING` → "Kuyrukta" (queued)
- `RUNNING` → "Çalışıyor" (working)
- `FAILED_RETRYABLE` → "Yeniden denenecek HH:MM"
- `COMPLETED` / `FAILED` → terminal

## 7. Section 2 — Trigger handoff (API → queue → worker)

### API route shrinks to "writer of intent"

`POST /v1/organizations/{orgId}/stores/{storeId}/products/sync`:

```
1. ensureOrgMember + requireOwnedStore (unchanged)
2. INSERT INTO sync_logs (status='PENDING', organizationId, storeId, syncType, …)
   ↳ on P2002 unique-violation: throw SyncInProgressError(409, { existingSyncLogId })
3. return 202 { syncLogId, status: 'PENDING', enqueuedAt }
```

The handler holds no Promises, schedules no work. `runInBackground` and the
in-process Promise pool are removed entirely.

### Worker discovery: pure polling

```ts
let backoff = 100;
while (!shuttingDown) {
  const claimed = await tryClaim();
  if (claimed) {
    backoff = 100;            // reset, more work likely
    await runSyncToCompletion(claimed);
  } else {
    await sleep(backoff);
    backoff = Math.min(backoff * 1.5, 5000);
  }
}
```

Idle cost: ~1 query / 5 s per worker. Active cost: tight loop, no sleep
between claims. No pg_notify wiring in v1 (deferred to v2).

### End-to-end trigger flow

```
User click ─► POST /sync ─► INSERT PENDING ─► 202 { syncLogId, PENDING }
                                  │
                                  └─(within ~1 s)─► worker tryClaim()
                                                       │
                                                       ▼
                                              UPDATE status=RUNNING, claimedAt=now()
                                                       │
                                                       ▼
                                           Realtime UPDATE ─► all org subscribers
```

Frontend optimistic UX: on receiving 202, immediately render "Kuyrukta"
state. When Realtime delivers `status: RUNNING`, transition to "Çalışıyor".
Same hook, same Realtime channel, no extra round-trips.

## 8. Section 3 — Worker job loop

### Process structure

`apps/sync-worker/` — new Node app, single entry point, runs as its own
deployable. Restart-safe by construction (any in-flight chunk is
recoverable from `pageCursor`).

### Code sharing extraction

Lifted out of `apps/api/src/`:

- **`packages/marketplace/`** — Trendyol/Hepsiburada adapters, mappers,
  types. Used by API for connect-probe, by worker for sync.
- **`packages/sync-core/`** — `sync-log.service`, error classes,
  `mapPrismaError`, crypto helpers. Used by API for enqueue, by worker for
  chunk lifecycle.
- **`apps/api/`** — routes only. Thin enqueue handlers.
- **`apps/sync-worker/`** — the loop + per-module sync services
  (`product-sync.worker.ts`, later `order-sync.worker.ts`, …).

This is a one-time refactor cost; from then on every new module is a
drop-in.

### The two-level loop

```ts
// outer: claim
while (!shuttingDown) {
  const syncLog = await tryClaim();
  if (!syncLog) { await sleep(backoff); backoff = min(backoff*1.5, 5000); continue; }
  backoff = 100;
  try {
    await runSyncToCompletion(syncLog);
  } catch (err) {
    await handleRunError(syncLog.id, err);
  }
}

// inner: chunks
async function runSyncToCompletion(syncLog: SyncLog): Promise<void> {
  let cursor = syncLog.pageCursor ?? null;
  let progress = syncLog.progressCurrent;
  const handler = MODULE_HANDLERS[syncLog.syncType];

  while (!shuttingDown) {
    const result = await handler.processChunk({ syncLog, cursor });

    if (result.kind === 'done') {
      await syncLogService.complete(syncLog.id, result.finalCount);
      return;
    }

    cursor = result.cursor;
    progress = result.progress;
    await syncLogService.tick(syncLog.id, {
      cursor, progress, total: result.total, stage: result.stage,
    });
  }

  // shutdown path: hand the row back so a peer (or post-restart self) resumes
  await syncLogService.releaseToPending(syncLog.id);
}
```

### Module handler contract

Uniform across products / orders / settlements / messages:

```ts
interface ModuleHandler {
  processChunk(input: {
    syncLog: SyncLog;
    cursor: unknown | null;
  }): Promise<ChunkResult>;
}

type ChunkResult =
  | { kind: 'continue'; cursor: unknown; progress: number; total: number | null; stage: string }
  | { kind: 'done'; finalCount: number };
```

Adding a new module = implement `ModuleHandler` + register in
`MODULE_HANDLERS`. The worker loop knows nothing about marketplaces; it's a
pure dispatcher.

### Heartbeat

`syncLogService.tick()` writes `lastTickAt = now()` after every chunk.
Watchdog threshold 90 s with chunk p99 sized at ~30 s gives 3× safety
margin. Chunks expected to exceed 60 s get explicit
`setInterval(heartbeat, 20_000)` while inside `processChunk`.

### Error handling

| Error class                                         | Action                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Marketplace 5xx (after PR-59 retries exhausted)     | `FAILED_RETRYABLE`, exponential backoff                                 |
| Marketplace 401 / auth                              | `FAILED` (terminal)                                                     |
| Marketplace 4xx other than 401/429                  | `FAILED` (terminal)                                                     |
| Trendyol returned malformed page (Zod fails)        | `FAILED` (terminal, log for ops)                                        |
| Postgres write error                                | propagate to outer loop → `FAILED_RETRYABLE`                            |
| `attemptCount > 5`                                  | `FAILED` (terminal regardless of error class)                           |

`FAILED_RETRYABLE` backoff:
`nextAttemptAt = now() + (2^attemptCount × 30s, capped at 30 min)`.
Sequence: 30 s → 1 m → 2 m → 4 m → 8 m → 16 m → terminal `FAILED`.
Total budget ~31 min over 5 attempts.

### Graceful shutdown (SIGTERM)

Critical for clean deploys:

1. SIGTERM arrives → `shuttingDown = true`. Outer loop stops claiming.
2. Inner loop checks `shuttingDown` *between* chunks (never mid-chunk).
   Current chunk's transaction commits cleanly.
3. After last chunk: `releaseToPending(syncLog.id)` →
   `status='PENDING', claimedAt=null, claimedBy=null`. Don't reset
   `pageCursor` — that's the resume point.
4. Worker process exits.

Any peer worker (or the next post-deploy instance of itself) re-claims
immediately. The user sees SyncCenter briefly show "Kuyrukta" then
"Çalışıyor" again — visible but harmless.

## 9. Section 4 — Dashboard subscription hoist

### Scope: org-wide

Filter Realtime by `organization_id=eq.<orgId>`. Single channel per user
per org, surfaces every store's syncs across the org. Safe because the
denormalized `organization_id` column on `sync_logs` (already shipped) lets
RLS evaluate flatly.

### Mount point

`apps/web/src/app/[locale]/(dashboard)/layout.tsx` — the dashboard shell
every authenticated route renders inside.

```
DashboardLayout
└── OrgSyncsProvider   ◄── new — opens 1 Realtime channel + REST hydrate
      ├── Sidebar (consumes useOrgSyncs() for badge counts)
      ├── PageHeader → SyncBadge (active count across stores)
      └── {children}  (every dashboard page)
```

### New API endpoint

`GET /v1/organizations/{orgId}/sync-logs?active=true` — org-scoped twin of
the existing store-scoped endpoint. Returns all `RUNNING` + last 5 finished
across every store the user can see, sorted active-first then newest.
Existing `GET /v1/.../stores/{storeId}/sync-logs` stays as the focused-store
view used by `products-page-client.tsx`.

### Provider + hook contract

```ts
// apps/web/src/features/sync/providers/org-syncs-provider.tsx
export function useOrgSyncs(): {
  activeSyncs: SyncLog[];   // RUNNING across all stores in org
  recentSyncs: SyncLog[];   // last N COMPLETED/FAILED across all stores
  isLoading: boolean;
};

export function useStoreSyncs(storeId: string): {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
};
// ⇣ derived view: filters useOrgSyncs() output by storeId.
//   No additional channel, no additional REST call.
```

The current `useActiveSyncLogs(orgId, storeId)` is deleted; every dashboard
page uses the single org-scoped channel via `useStoreSyncs(storeId)` for
focused views or `useOrgSyncs()` for the cross-store header badge.

### UI surface changes (extend existing patterns, no new aesthetic)

- **`SyncBadge`** (`components/patterns/sync-badge.tsx`): prop extended to
  accept N active syncs. N=0 inert; N=1 single-sync progress (today's
  behavior); N≥2 stacked indicator with count badge. Reuses existing
  `--success` / `--info` semantic tones — no new tokens.
- **`SyncCenter`** (`components/patterns/sync-center.tsx`): when syncs span
  multiple stores, group rows by store using existing store-name +
  marketplace-logo header pattern. Single-store case renders identically
  to today.
- **No new primitives needed.** Sheet, Badge, Button, Progress, Skeleton
  from `ui/` cover everything.

### Channel lifecycle (reuses PR #59 health logic)

`OrgSyncsProvider` calls `subscribeToOrgSyncs(orgId, { onEvent, onHealthChange })`
from `lib/supabase/realtime.ts` — refactor of the current
`subscribeToSyncLogs(storeId, …)` to filter by `organization_id`.
Visibility-pause + health-gated polling fallback (PR #59) carry over
unchanged. One channel for the whole dashboard means lower client overhead
than today's per-feature channels.

### Optimistic trigger UX, end-to-end

```
User clicks "Senkronize Et" on /products
  └─► POST /sync ─► 202 PENDING
        └─► useStartProductSync mutation onSuccess:
             setQueryData(orgSyncsKeys.active, prev => [pendingRow, ...prev])
                                                       ▲ optimistic
  ⏱ ~1 s later
  └─► worker claim ─► Realtime UPDATE status=RUNNING
        └─► OrgSyncsProvider patches cache via setQueryData
              └─► SyncBadge re-renders with progress (everywhere in dashboard)
```

User B in the same org, on a different page, sees the SyncBadge in the
header light up via the same Realtime UPDATE. No code in User B's tab knew
anything about the sync until Realtime delivered it.

## 10. Out of scope (deferred follow-ups)

- **Cancel a running sync.** Future feature; will likely flip a
  `cancelRequested` flag on the SyncLog that the worker checks between
  chunks.
- **Per-marketplace token-bucket rate coordination across workers.** v1
  with a single worker is fine. Multi-worker needs a Postgres-coordinated
  counter per `(platform, endpoint)`; PR-59's per-fetch retry is the
  safety net until then.
- **`pg_notify` low-latency wake.** Polling at ~1 s p50 is acceptable for
  v1. Add notify-on-INSERT for sub-100ms wake when latency demands it.
- **Promotion to pgmq queue substrate ("D2").** When per-module priority
  (orders > products > settlements) or dead-letter handling is needed,
  swap the worker's claim source from the SyncLog table to a pgmq queue;
  SyncLog stays as the user-facing observation surface.
- **Multi-instance Hono coordination.** If the API ever runs as N
  instances, the partial unique index already prevents duplicate enqueue;
  no further coordination needed for the trigger path.

## 11. Migration path

This is a non-trivial refactor of the existing sync system. Suggested
order (detailed sequencing in the implementation plan):

1. **Schema**: add new SyncLog columns, partial unique index, extend
   `SyncStatus` enum with `PENDING` + `FAILED_RETRYABLE`.
2. **Code extraction**: `packages/marketplace/`, `packages/sync-core/`.
   API and (forthcoming) worker both import from these.
3. **New `apps/sync-worker/` deployable**. Worker loop, dispatcher,
   product-sync handler. Watchdog included.
4. **API route refactor**: drop `runInBackground`, replace with PENDING
   insert. Handle P2002 → 409 path. Update OpenAPI spec.
5. **Frontend**: `OrgSyncsProvider` in dashboard layout; new org-scoped
   `subscribeToOrgSyncs`; `useStoreSyncs` derived view; delete the old
   `useActiveSyncLogs`.
6. **Cutover**: deploy worker alongside API; flip trigger to PENDING;
   remove old in-process path. Any SyncLog rows still `RUNNING` at the
   moment of API restart are orphaned (their in-process Promise dies);
   a one-shot cutover script marks them `FAILED ('MIGRATION_INTERRUPTED')`
   so the user can manually retrigger. Going forward all rows go through
   the new path.

### Backwards compatibility

No public API contract change at the route level. The 202 response's
`status` field transitions from `'RUNNING'` to `'PENDING'`; the frontend
should treat both as "active" / "in progress" for display purposes.
Existing OpenAPI client regenerates cleanly — only the enum widens.

## 12. Tests required (will be detailed in implementation plan)

- **Tenant isolation**: a sync started by org A is not visible in org B's
  Realtime channel.
- **Worker concurrency**: two workers race for the same row; one claims;
  the other moves on.
- **Crash recovery**: worker process kill mid-chunk → watchdog requeues
  after 90 s → another worker resumes from saved cursor.
- **Retry policy**: transient marketplace 5xx exhausts retries →
  `FAILED_RETRYABLE` → next attempt fires after backoff window.
- **Dashboard hoist**: any user on any dashboard route sees a sync
  triggered on their org by any other user.
- **Dedup**: two concurrent POSTs to `/sync` for the same store → one 202,
  one 409 with `existingSyncLogId`.
- **Graceful shutdown**: SIGTERM mid-chunk → chunk completes → row goes
  back to `PENDING` → next worker resumes.

## 13. Open questions for the implementation plan

- Worker deployment target (Fly.io / Render / Railway / self-hosted). Not
  architecturally significant; affects ops setup.
- Worker count for v1 production. Start with 1; auto-scaling rules to be
  defined when load demands.
- Exact `pageCursor` shape for orders / settlements / messages. Each
  module's first PR will lock its own Zod schema.
