# Sync Engine v2 — Completion Handoff (Bug Fix + Audit Gap Closure)

> **For a fresh Claude session.** You have no context from prior sessions. This document is self-contained: read it end-to-end, then start with §B (the bug investigation) before anything else.

**Created:** 2026-04-28
**Audit reference:** `docs/audits/2026-04-28-sync-plan-audit.md`
**Spec reference:** `docs/plans/2026-04-27-sync-engine-architecture-design.md`
**Implementation plan reference:** `docs/plans/2026-04-27-sync-engine-architecture-implementation.md`

---

## §0. Mission

You will:

1. **§B — Investigate and fix a specific live bug.** A user-triggered Trendyol product sync gets stuck at `FAILED_RETRYABLE` and never resumes, even though the SyncCenter UI says "Yeniden denenecek" (will retry). Hours pass and `attemptCount` stays at 2. This is the priority — it blocks real product use.
2. **§C — Add observability** so this class of bug is debuggable next time without guesswork.
3. **§D — Close 4 audit gaps** that the prior session shipped without (Realtime wire shape `organization_id`, optimistic UX `setQueryData`, end-to-end test, multi-worker concurrency test).
4. **§E — Implement the 7 spec §12 test scenarios** that were skipped or only partially covered.

You may **not** invent additional scope. If you find something that looks broken outside this list, report it back; do not unilaterally fix it.

---

## §1. Required reading (in this order, before any code change)

You must read these files end-to-end before touching code. Skipping = wrong assumptions.

1. `CLAUDE.md` (repo root) — coding standards, testing rules, multi-tenancy invariants. Critical sections: TypeScript Discipline, Testing, Multi-Tenancy Model.
2. `apps/api/CLAUDE.md` — backend conventions, RFC 7807 errors, Prisma 7.
3. `apps/web/CLAUDE.md` — React/Next 16 conventions, three Supabase client flavors, error pipeline.
4. `docs/SECURITY.md` — tenant isolation invariants and the §9 review checklist.
5. **`docs/plans/2026-04-27-sync-engine-architecture-design.md`** — spec for the v2 sync engine. Sections 1–13. North star.
6. **`docs/plans/2026-04-27-sync-engine-architecture-implementation.md`** — PR-by-PR plan with exact code per task.
7. **`docs/audits/2026-04-28-sync-plan-audit.md`** — independent verification of what shipped. §1 is the approved-scope checklist; §4 lists every gap with priority.

---

## §2. Architecture refresher (so you can debug without re-reading everything)

The v2 sync engine has three independent processes that cooperate via Postgres:

```
Browser            Hono API           Postgres            sync-worker (Node)
  │                    │                  │                   │
  │ POST /sync         │                  │                   │
  │ ─────────────────► │ INSERT PENDING   │                   │
  │                    │ ────────────────►│                   │
  │ 202 { syncLogId }  │                  │                   │
  │ ◄───────────────── │                  │                   │
  │                    │                  │  tryClaimNext()  │
  │                    │                  │ ◄─────────────── │
  │                    │                  │  UPDATE→RUNNING   │
  │                    │                  │ ───────────────► │
  │                    │                  │   ┌─ chunk loop ──┤
  │                    │                  │   │ fetch page    │
  │                    │                  │   │ upsert tx     │
  │                    │                  │   │ tick(cursor)  │
  │ Realtime UPDATE    │                  │   │ ──────────────►
  │ ◄──────────────────────────────────── │ ◄─┘               │
  │                    │                  │   complete()      │
  │                    │                  │ ◄──────────────── │
  │ Realtime UPDATE    │                  │                   │
  │ ◄──────────────────────────────────── │                   │
```

Key files:

| Path | Purpose |
|---|---|
| `apps/api/src/routes/product.routes.ts` | API trigger handler. INSERT PENDING + return 202. NEVER runs sync work. |
| `apps/sync-worker/src/index.ts` | Worker entry point. Polls `tryClaimNext`, dispatches, retries with backoff. |
| `apps/sync-worker/src/loop.ts` | Inner chunk loop: dispatch → tick → done|release. |
| `apps/sync-worker/src/dispatcher.ts` | Routes `syncType` → handler. Decodes `pageCursor`. |
| `apps/sync-worker/src/handlers/products.ts` | Trendyol products handler. ONE page per chunk. |
| `apps/sync-worker/src/watchdog.ts` | Sweeps stale `RUNNING` claims back to `PENDING` every 30 s. |
| `packages/sync-core/src/claim.ts` | `tryClaimNext` — `SELECT … FOR UPDATE SKIP LOCKED` claim helper. |
| `packages/sync-core/src/sync-log.service.ts` | `acquireSlot`, `tick`, `releaseToPending`, `markRetryable`, etc. |
| `packages/sync-core/src/checkpoint.ts` | Zod cursor parsers (`{kind:'page',n}` or `{kind:'token',token}`). |
| `packages/sync-core/src/errors.ts` | `SyncInProgressError`, `MarketplaceUnreachable`, `MarketplaceAuthError`, etc. |
| `apps/web/src/features/sync/providers/org-syncs-provider.tsx` | OrgSyncsProvider — single Realtime channel per user, mounted in dashboard layout. |
| `apps/web/src/lib/supabase/realtime.ts` | `subscribeToOrgSyncs` — postgres_changes filter `organization_id=eq.<orgId>`. |
| `apps/web/src/components/patterns/sync-center.tsx` | SyncCenter sheet: Active / Retrying / Recent buckets. |
| `apps/web/src/components/patterns/sync-badge.tsx` | Header SyncBadge with N=0/1/≥2 surfaces. |

State machine on `sync_logs`:

```
                 ┌─ COMPLETED       (terminal, success)
PENDING ─► RUNNING ─┤
                 ├─ FAILED          (terminal, permanent)
                 └─ FAILED_RETRYABLE ──(after backoff)──► PENDING (via tryClaimNext, NOT watchdog)
```

Atomic invariants:

- Partial unique index `sync_logs_active_slot_uniq` on `(store_id, sync_type) WHERE status IN ('PENDING','RUNNING','FAILED_RETRYABLE')` — Postgres rejects duplicate active rows. Concurrent triggers → one wins, others get `P2002` → mapped to `SyncInProgressError(409)` with `meta.existingSyncLogId`.
- `tryClaimNext` uses `SELECT … FOR UPDATE SKIP LOCKED` — multi-worker safe, no coordination.
- `markRetryable` backoff: `nextAttemptAt = now() + min(30s × 2^(attemptCount-1), 30 min)`. `MAX_ATTEMPTS = 5` then terminal `FAILED`.
- Watchdog (90 s threshold, 30 s tick) reaps `RUNNING` rows whose `lastTickAt` is stale. Does NOT touch `FAILED_RETRYABLE`.

---

## §B. THE BUG — Investigate and fix this first

### Symptom (verbatim from the user)

> Click the SyncBadge → SyncCenter sheet opens → click "Ürünleri şimdi senkronize et". Sync starts and progresses to ~2,500 of 5,636 products fetched (44%), then a Trendyol stage 5xx hits and the row goes to `FAILED_RETRYABLE`. SyncCenter shows the **"Yeniden Deneniyor"** section with "MARKETPLACE_UNREACHABLE · Marketplace unreachable (500) — upstream issue" and "Yeniden denenecek 3 saat önce · Deneme 2".
>
> Hours pass. `attemptCount` stays at 2. The "willRetry" timestamp is in the past ("3 saat önce" = "3 hours ago"). Nothing retries. The progress bar is frozen at 43%.

### What this tells you (read carefully — this is the diagnosis)

The state machine says: a `FAILED_RETRYABLE` row whose `nextAttemptAt <= now()` MUST be picked up by the next `tryClaimNext` call. The claim SQL is:

```sql
WHERE (status = 'PENDING')
   OR (status = 'FAILED_RETRYABLE' AND next_attempt_at <= now())
```

If `nextAttemptAt` was 3 hours ago and the row is untouched, exactly one of these is true:

1. **The worker process is not running.** No `tryClaimNext` calls are happening. (This is the most likely cause for a local-dev session.)
2. **The worker is running but never wakes up to claim.** Possible if the polling loop is wedged or the DB connection is dead.
3. **The worker is calling `tryClaimNext` but it's returning `null` despite the row being claimable.** Possible if the SQL has a bug or the row's `next_attempt_at` is somehow malformed.

`attemptCount` stuck at 2 (not climbing) confirms the worker isn't even *trying*. If it were claiming and failing, `attemptCount` would grow. So this is hypothesis 1 or 2, not 3.

### Investigation procedure (run in this order)

**Step 1: Check whether the worker process is running.**

```bash
# Look for the worker entry file in any running node process
ps aux | grep -E "sync-worker|apps/sync-worker" | grep -v grep
```

- If output is empty → **worker is not running.** Most likely cause. Go to "Fix path A".
- If a process is listed → worker is running. Go to "Fix path B".

**Step 2 (only if worker is running): Check the worker's stdout.**

The worker logs (currently sparse) should show `[worker-xxxxxxxx] sync-worker starting` on boot and `[worker-xxxxxxxx] claimed sync_log <uuid> (PRODUCTS)` whenever it claims a row. If the worker has been alive for hours but logged no recent claim, it should at least be polling. The current implementation has **no log on poll-tick** — that's part of why you can't tell.

You will add structured logging in §C (do that first if you reach Step 2).

**Step 3 (any path): Inspect the actual DB row.**

```bash
cd packages/db
npx tsx --env-file-if-exists=../../.env -e "
import { prisma } from '@pazarsync/db';
async function main() {
  const rows = await prisma.syncLog.findMany({
    where: { status: 'FAILED_RETRYABLE' },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });
  for (const r of rows) {
    console.log({
      id: r.id,
      status: r.status,
      attemptCount: r.attemptCount,
      progressCurrent: r.progressCurrent,
      progressTotal: r.progressTotal,
      claimedAt: r.claimedAt,
      claimedBy: r.claimedBy,
      lastTickAt: r.lastTickAt,
      nextAttemptAt: r.nextAttemptAt,
      pageCursor: r.pageCursor,
      errorCode: r.errorCode,
      now: new Date(),
      isClaimable: r.nextAttemptAt !== null && r.nextAttemptAt <= new Date(),
    });
  }
}
main();
"
```

**What you're verifying:**
- `claimedAt` / `claimedBy` should be `null` (markRetryable clears them on failure).
- `nextAttemptAt` should be in the past (so `isClaimable: true`).
- `pageCursor` should be a non-null `{ kind: 'page', n: <number> }` or `{ kind: 'token', token: '<string>' }` — this is the resume point.

If `pageCursor` is `null` despite progress at 2400 items: that's a separate bug — the resume cursor was never persisted.

If `claimedAt` is NOT null on a `FAILED_RETRYABLE` row: that's a third separate bug — `markRetryable` didn't clear claim ownership.

If `nextAttemptAt` is null: `markRetryable` didn't set it.

### Fix path A — Worker not running

**Immediate fix (5 min):**

In a separate terminal:

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas
pnpm --filter @pazarsync/sync-worker dev
```

Watch the output. You should see:
1. `[worker-xxxxxxxx] sync-worker starting`
2. Within ~1 s, if the stuck `FAILED_RETRYABLE` row's `nextAttemptAt` is in the past: `[worker-xxxxxxxx] claimed sync_log <uuid> (PRODUCTS)`
3. The row resumes from its saved `pageCursor` and finishes the remaining 3,236 products.

If step 2 doesn't happen, you're in fix path B.

**Permanent fix (so this never happens again):**

The root cause for local dev is "user didn't start the worker." Add it to the dev-start script so `pnpm dev` from the repo root starts API + web + worker together. Modify `package.json` (root) — find the existing `dev` script (likely a `turbo run dev` invocation) and ensure `apps/sync-worker` participates. If `turbo.json` has a `dev` task, no change needed there; just verify by running `pnpm dev` and watching all three processes start.

Verify with:

```bash
pnpm dev 2>&1 | grep -E "sync-worker|api|web"
```

You should see lines from all three.

### Fix path B — Worker running but not claiming

If you reach this path, finish §C (observability) first, restart the worker, and watch the logs. The logs will tell you:
- If `tryClaimNext` is being called (poll tick log).
- If it's returning `null` (no row found despite one being claimable).
- If it's claiming a row but the chunk fails before `tick()`.

Likely sub-causes if you reach here:
- DB connection pool exhausted — the worker's `prisma` client failed to reconnect after the API process restarted.
- Postgres timezone mismatch — `nextAttemptAt` stored without timezone, comparing against `now()` returns wrong result. (Audit §3.4 noted this as a deviation but probably benign; verify here if you suspect it.)
- The row is locked by a stale transaction. Run `SELECT pid, query, state FROM pg_stat_activity WHERE state != 'idle' AND query LIKE '%sync_logs%';` to check.

### Acceptance criteria for §B

- [ ] Worker process visibly claims and resumes the stuck `FAILED_RETRYABLE` row.
- [ ] After resumption, the row progresses past 2,500 → completes → `status = 'COMPLETED'`.
- [ ] `pnpm dev` from repo root starts API + web + worker (one less foot-gun).

---

## §C. Add observability (do this BEFORE fix path B, useful regardless)

The worker is currently silent on most state transitions. You can't tell what's happening when something goes wrong. Add structured logging at every state transition.

### C.1 — Logger utility

Create `packages/sync-core/src/logger.ts`:

```ts
// Tiny structured logger for the sync engine. Uses console.log
// (Hono and the worker both write to stdout in dev/prod), formats as
// JSON when NODE_ENV=production, pretty-prints otherwise. No deps.

interface LogContext {
  syncLogId?: string;
  storeId?: string;
  organizationId?: string;
  syncType?: string;
  workerId?: string;
  [key: string]: unknown;
}

function emit(level: 'info' | 'warn' | 'error', event: string, ctx: LogContext = {}): void {
  const record = { timestamp: new Date().toISOString(), level, event, ...ctx };
  if (process.env['NODE_ENV'] === 'production') {
    console.log(JSON.stringify(record));
  } else {
    const prefix = level === 'error' ? '✗' : level === 'warn' ? '!' : '·';
    const ctxStr = Object.entries(ctx)
      .filter(([k]) => k !== 'event')
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    console.log(`${prefix} [sync] ${event}${ctxStr.length > 0 ? ' ' + ctxStr : ''}`);
  }
}

export const syncLog = {
  info: (event: string, ctx?: LogContext) => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => emit('error', event, ctx),
};
```

Re-export from `packages/sync-core/src/index.ts`:

```ts
export { syncLog } from './logger';
```

### C.2 — Instrument every state transition in `sync-log.service.ts`

For each of these functions, add a log line at the top (BEFORE the prisma call) and on error:

| Function | Event name | Log fields |
|---|---|---|
| `acquireSlot` | `slot.acquire.attempt` then `slot.acquired` or `slot.conflict` | `organizationId, storeId, syncType` (+ `existingSyncLogId` on conflict) |
| `tick` | `chunk.tick` | `syncLogId, progress, total, stage, cursor` |
| `complete` | `sync.completed` | `syncLogId, finalCount` |
| `fail` | `sync.failed` | `syncLogId, errorCode, errorMessage` |
| `markRetryable` | `sync.retryable` | `syncLogId, attemptCount, errorCode, nextAttemptAt` |
| `releaseToPending` | `sync.released` | `syncLogId` |

Example pattern (for `markRetryable`):

```ts
import { syncLog } from './logger';

export async function markRetryable(
  syncLogId: string,
  attemptCount: number,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const backoffMs = Math.min(30_000 * Math.pow(2, attemptCount - 1), 30 * 60_000);
  const nextAttemptAt = new Date(Date.now() + backoffMs);
  syncLog.warn('sync.retryable', { syncLogId, attemptCount, errorCode, nextAttemptAt: nextAttemptAt.toISOString() });
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      status: 'FAILED_RETRYABLE',
      errorCode,
      errorMessage,
      nextAttemptAt,
      claimedAt: null,
      claimedBy: null,
    },
  });
}
```

### C.3 — Instrument the worker loop (`apps/sync-worker/src/index.ts`)

Replace the current `console.log` calls with `syncLog.info` / `.warn` / `.error`. Add new logs:

| Where | Event name | Notes |
|---|---|---|
| Boot | `worker.starting` | Already logs; switch to structured. |
| Every poll tick when claim returns null | `worker.poll.idle` | Throttle to once per 30 s — don't log on every tight-loop tick. Track `lastIdleLogAt`. |
| On claim | `worker.claim.acquired` | Already logs; structure it. Include `syncLogId`, `syncType`, `attemptCount`. |
| On run start (entering `runSyncToCompletion`) | `worker.run.start` | |
| On run done | `worker.run.complete` | |
| On run error | `worker.run.error` | Include `errorCode`, `errorMessage`. |
| On shutdown signal | `worker.shutdown.requested` | |
| Watchdog tick — when it reaps something | `watchdog.reaped` | Include count. |
| Watchdog tick — when nothing reaped | (silent — already noisy enough) | |

### C.4 — Instrument the products handler (`apps/sync-worker/src/handlers/products.ts`)

Add at start of `processProductsChunk`:

```ts
syncLog.info('chunk.start', {
  syncLogId: input.syncLog.id,
  storeId: input.syncLog.storeId,
  cursor: input.cursor,
  progressCurrent: input.syncLog.progressCurrent,
});
```

Add before returning `kind: 'continue'`:

```ts
syncLog.info('chunk.complete', {
  syncLogId: input.syncLog.id,
  pageBatchSize: batch.length,
  newProgress,
  totalElements: pageMeta.totalElements,
  nextCursor,
});
```

Replace the existing `console.error('[product-sync] content-upsert failed', ...)` with:

```ts
syncLog.error('content.upsert.failed', {
  syncLogId: input.syncLog.id,
  storeId: store.id,
  platformContentId: mapped.platformContentId.toString(),
  productMainId: mapped.productMainId,
  errorMessage: err instanceof Error ? err.message : String(err),
});
```

### C.5 — Instrument the API enqueue path (`apps/api/src/routes/product.routes.ts`)

Add to the start-sync handler, after `acquireSlot` returns:

```ts
syncLog.info('trigger.enqueued', {
  syncLogId: log.id,
  organizationId,
  storeId: store.id,
  syncType: 'PRODUCTS',
  userId,
});
```

(Import: `import { syncLog } from '@pazarsync/sync-core';`)

### Acceptance criteria for §C

- [ ] Run a full sync in dev. Watch the worker stdout. Every state transition appears as a single structured log line.
- [ ] Trigger a deliberate failure (e.g., revoke Trendyol creds mid-sync). The log shows `chunk.start` → `content.upsert.failed` (or fetch error) → `worker.run.error` → `sync.retryable` with the next-attempt-at value.
- [ ] After waiting past `nextAttemptAt`, log shows `worker.claim.acquired` for the same row → `chunk.start` resumes from the saved cursor.

---

## §D. Audit gaps to close

These are the deviations from the plan that the prior session shipped without. From `docs/audits/2026-04-28-sync-plan-audit.md` §3, §4.

### D.1 — Add `organization_id` to the Realtime wire shape [HIGH PRIORITY]

**Why:** The plan explicitly required this. Without it, the in-memory `SyncLog` reconstruction in `applyEvent` silently drops `organizationId`, leaving no defense-in-depth on the client. Today the Supabase Realtime channel filter `organization_id=eq.<orgId>` does the work server-side, so cross-org leakage is prevented — but a future refactor that changes the channel filter would silently break tenant isolation.

**File:** `apps/web/src/lib/supabase/realtime.ts`

**Changes:**

```diff
 interface SyncLogsRowWire {
   id: string;
+  organization_id: string;
   store_id: string;
   sync_type: 'PRODUCTS' | 'ORDERS' | 'SETTLEMENTS';
   status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FAILED_RETRYABLE';
   ...
 }

 export interface SyncLogRealtimeShape {
   id: string;
+  organizationId: string;
   storeId: SyncLogsRowWire['store_id'];
   ...
 }

 function snakeToCamel(row: SyncLogsRowWire): SyncLogRealtimeShape {
   return {
     id: row.id,
+    organizationId: row.organization_id,
     storeId: row.store_id,
     ...
   };
 }
```

Then propagate `organizationId` through `applyEvent` in `apps/web/src/features/sync/providers/org-syncs-provider.tsx` (around line 146) — add it to the reconstructed `SyncLog`.

**API contract change:** Also add `organizationId` to `SyncLogResponseSchema` in `apps/api/src/validators/product.validator.ts` and the corresponding `toSyncLogResponse` mapper. Regenerate the OpenAPI client (`pnpm api:sync`).

**Test:** Update `apps/web/tests/unit/features/sync/use-org-syncs.test.tsx` to include `organizationId` in mock event payloads and assert it survives in the cache.

### D.2 — Optimistic UX `setQueryData` on trigger [HIGH PRIORITY]

**Why:** Spec §9 ("Optimistic trigger UX, end-to-end") requires that on `useStartProductSync.onSuccess`, the cache is updated with the PENDING row immediately so the SyncBadge transitions instantly. The current implementation only invalidates and waits for refetch + Realtime, which causes a visible flicker between click and badge appearing.

**File:** `apps/web/src/features/products/hooks/use-start-product-sync.ts`

**Change:** Replace the current `onSuccess` body:

```ts
onSuccess: (data) => {
  if (orgId === null || storeId === null) return;
  const queryKey = orgSyncKeys.list(orgId);
  queryClient.setQueryData<SyncLog[] | undefined>(queryKey, (existing) => {
    const optimistic: SyncLog = {
      id: data.syncLogId,
      organizationId: orgId,
      storeId,
      syncType: 'PRODUCTS',
      status: 'PENDING',
      startedAt: data.enqueuedAt,
      completedAt: null,
      recordsProcessed: 0,
      progressCurrent: 0,
      progressTotal: null,
      progressStage: null,
      errorCode: null,
      errorMessage: null,
      attemptCount: 0,
      nextAttemptAt: null,
    };
    return [optimistic, ...(existing ?? []).filter((s) => s.id !== data.syncLogId)];
  });
  // Still invalidate so the eventual canonical row replaces the optimistic one.
  void queryClient.invalidateQueries({ queryKey });
},
```

Note: this requires `D.1` (organizationId in SyncLog) to be done first OR you can omit `organizationId` from the optimistic row if the type allows it.

**Test:** Add to `apps/web/tests/unit/features/sync/use-org-syncs.test.tsx` — fire `startProductSync` mock, assert the cache has the optimistic PENDING row before any Realtime event arrives.

### D.3 — End-to-end integration test [HIGH PRIORITY]

**Why:** This is the single most important missing test. It proves the entire pipeline works as a system. Spec §12 implicitly requires it; plan §PR-4 file list line 840 explicitly listed it.

**File:** `apps/sync-worker/tests/integration/end-to-end.test.ts` (CREATE)

**What it tests:**
- INSERT a `PENDING` `sync_logs` row directly (simulating the API trigger)
- Mock `globalThis.fetch` to return a Trendyol-shaped response with 2 pages
- Manually call `tryClaimNext` to claim the row
- Manually drive `runSyncToCompletion` to process all chunks
- Assert: row reaches `COMPLETED`, `progressCurrent` matches total, products are upserted

**Test sketch:**

```ts
import { prisma } from '@pazarsync/db';
import { tryClaimNext } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '@pazarsync/sync-core';

import { runSyncToCompletion } from '../../src/loop';
import { productsHandler } from '../../src/handlers/products';
import { ensureDbReachable, truncateAll } from '../../../apps/api/tests/helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../../apps/api/tests/helpers/factories';

describe('sync engine end-to-end', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('PENDING → claim → 2-page sync → COMPLETED with products upserted', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'E2E Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '2738',
        credentials: encryptCredentials({ supplierId: '2738', apiKey: 'k', apiSecret: 's' }),
      },
    });

    // 1. API trigger: insert PENDING row
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    // 2. Mock Trendyol with 2 pages of 1 product each
    const page0 = makeTrendyolResponse({ totalElements: 2, page: 0, contentId: 100 });
    const page1 = makeTrendyolResponse({ totalElements: 2, page: 1, contentId: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(page0))
      .mockResolvedValueOnce(jsonResponse(page1));

    // 3. Claim
    const claimed = await tryClaimNext('worker-e2e');
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('RUNNING');

    // 4. Drive the loop to completion
    await runSyncToCompletion(claimed!, { PRODUCTS: productsHandler }, () => false);

    // 5. Assert final state
    const final = await prisma.syncLog.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(final.status).toBe('COMPLETED');
    expect(final.recordsProcessed).toBe(2);

    const products = await prisma.product.findMany({ where: { storeId: store.id } });
    expect(products).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// helpers — copy from products-handler.test.ts:
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
function makeTrendyolResponse(opts: { totalElements: number; page: number; contentId: number }) {
  return {
    totalElements: opts.totalElements,
    totalPages: opts.totalElements,
    page: opts.page,
    size: 100,
    nextPageToken: null,
    content: [
      {
        contentId: opts.contentId,
        productMainId: `pm-${opts.contentId}`,
        brand: { id: 1, name: 'Test' },
        category: { id: 2, name: 'Test' },
        creationDate: 1777246115403,
        lastModifiedDate: 1777246115403,
        title: `Product ${opts.contentId}`,
        attributes: [],
        variants: [{
          variantId: opts.contentId * 10,
          supplierId: 2738,
          barcode: `bc-${opts.contentId}`,
          stockCode: `sk-${opts.contentId}`,
          attributes: [],
          onSale: true,
          deliveryOptions: { deliveryDuration: 1, isRushDelivery: false, fastDeliveryOptions: [] },
          stock: { quantity: 5, lastModifiedDate: 0 },
          price: { salePrice: 100, listPrice: 100 },
          vatRate: 20,
          locked: false,
          archived: false,
          blacklisted: false,
        }],
      },
    ],
  };
}
```

### D.4 — SyncCenter component test for FAILED_RETRYABLE [MEDIUM PRIORITY]

**Why:** PR #68 deferred this test explicitly: "Add a regression test for SyncCenter that asserts FAILED_RETRYABLE rows render in the retrying section with the error code and retry timing." Without it, a future refactor could re-collapse the buckets and the same regression silently ships.

**File:** `apps/web/tests/component/sync-center.test.tsx` (CREATE)

**Test cases:**
1. A `FAILED_RETRYABLE` row renders inside the "Yeniden Deneniyor" section (not "Geçmiş").
2. The row shows the `errorCode` and `errorMessage`.
3. The row shows "Yeniden denenecek HH:MM" with the `nextAttemptAt` timestamp formatted.
4. The row shows "Deneme N" with the `attemptCount`.
5. The "Ürünleri şimdi senkronize et" button is **disabled** when a `FAILED_RETRYABLE` row exists for that syncType (because the partial unique index would 409).

Use the patterns/sync-center.tsx and existing test patterns from `apps/web/tests/component/sync-badge.test.tsx`. Render via `render()` from `tests/helpers/render.tsx` with `NextIntlClientProvider`.

---

## §E. Test scenarios from spec §12

These are the 7 tests the spec required. See audit §1.5 for the status matrix. Implement the missing/partial ones.

### E.1 — Multi-worker concurrency (T2) [HIGH PRIORITY]

**Why:** The whole "scale out by adding workers" claim hinges on `SELECT … FOR UPDATE SKIP LOCKED` working. The current `claim.test.ts` runs single-worker only.

**File:** `packages/sync-core/tests/integration/claim.test.ts` (EXTEND)

**New test case:**

```ts
it('two simultaneous tryClaimNext calls cannot both claim the same PENDING row', async () => {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  // Seed exactly one PENDING row.
  const log = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'PRODUCTS',
      status: 'PENDING',
      startedAt: new Date(),
    },
  });

  // Race two workers. Promise.all() launches both microtasks before
  // either resolves; under SKIP LOCKED only one wins, the other returns
  // null without blocking.
  const [a, b] = await Promise.all([
    tryClaimNext('worker-A'),
    tryClaimNext('worker-B'),
  ]);

  const winners = [a, b].filter((x) => x !== null);
  const losers = [a, b].filter((x) => x === null);

  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(1);
  expect(winners[0]?.id).toBe(log.id);
  expect(['worker-A', 'worker-B']).toContain(winners[0]?.claimedBy);
});

it('concurrent claims across 5 workers + 5 PENDING rows distribute correctly', async () => {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  // Seed 5 different stores × 1 PENDING row each (different syncType
  // would also work, but stores feel more realistic).
  const stores = await Promise.all(
    Array.from({ length: 5 }, () => createStore(org.id)),
  );
  await Promise.all(
    stores.map((s) =>
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: s.id,
          syncType: 'PRODUCTS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ),
  );

  // Race 5 workers.
  const claimed = await Promise.all(
    ['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => tryClaimNext(id)),
  );
  const successes = claimed.filter((x) => x !== null);
  expect(successes).toHaveLength(5);
  // Each worker claimed a distinct row.
  const ids = new Set(successes.map((s) => s!.id));
  expect(ids.size).toBe(5);
});
```

### E.2 — Realtime tenant isolation (T1) [HIGH PRIORITY for security]

**Why:** Spec §12 requires "a sync started by org A is not visible in org B's Realtime channel." The existing `sync-logs-org.test.ts` covers REST + RLS. The Realtime path is a different evaluator — needs its own test.

**File:** `apps/api/tests/integration/rls/sync-logs-realtime.rls.test.ts` (CREATE)

**Approach:** Use the pattern from `apps/api/tests/integration/rls/` — `createRlsScopedClient` connects supabase-js as the `authenticated` role with a real JWT, mirroring the actual browser→Realtime auth.

**Test sketch:**

```ts
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@pazarsync/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createRlsScopedClient } from '../../helpers/rls-client';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore, createUserProfile } from '../../helpers/factories';

describe('Realtime tenant isolation — sync_logs', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });

  it("user A's Realtime channel does not receive events from org B's syncs", async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const userB = await createUserProfile();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createStore(orgB.id);

    // User A subscribes to the org-A Realtime channel.
    const { client: clientA } = await createRlsScopedClient(userA);
    const events: unknown[] = [];
    const channel = clientA
      .channel(`sync_logs:org:${orgA.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_logs', filter: `organization_id=eq.${orgA.id}` },
        (payload) => events.push(payload),
      )
      .subscribe();

    // Wait for subscription confirm.
    await waitForSubscribed(channel);

    // INSERT a row in org B (via Prisma superuser, bypassing RLS).
    await prisma.syncLog.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // Wait long enough for the event to propagate if RLS were broken.
    await sleep(2000);

    // Assert: no events for user A.
    expect(events).toEqual([]);

    // Cleanup
    await clientA.removeChannel(channel);
  });

  it("user A's Realtime channel DOES receive events from org A's own syncs", async () => {
    // Mirror test, but INSERT in org A — assert at least one INSERT event arrives.
  });
});

function waitForSubscribed(channel: any, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Subscribe timeout')), timeoutMs);
    const check = setInterval(() => {
      if (channel.state === 'joined') {
        clearTimeout(timer); clearInterval(check); resolve();
      }
    }, 50);
  });
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

You may need to add `await waitForSubscribed` helper logic; check existing realtime usage in tests for the exact channel state matcher. If `createRlsScopedClient` doesn't accept a userProfile shape, adapt to its actual signature (read `apps/api/tests/helpers/rls-client.ts`).

### E.3 — Crash recovery: resume from cursor (T3 full) [MEDIUM PRIORITY]

**Why:** The watchdog test (`apps/sync-worker/tests/integration/watchdog.test.ts`) verifies that stale `RUNNING` rows go back to `PENDING`. It does NOT verify that the next claim resumes from the saved cursor.

**File:** `apps/sync-worker/tests/integration/watchdog.test.ts` (EXTEND with one new case)

```ts
it('after watchdog reaps a stale RUNNING row, tryClaimNext resumes from saved cursor', async () => {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  // Seed a RUNNING row with stale lastTickAt and a saved cursor at page 5.
  const log = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'PRODUCTS',
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 5 * 60_000),
      claimedAt: new Date(Date.now() - 5 * 60_000),
      claimedBy: 'worker-dead',
      lastTickAt: new Date(Date.now() - 2 * 60_000), // 2 min ago, threshold 90s
      attemptCount: 1,
      progressCurrent: 500,
      progressTotal: 1000,
      pageCursor: { kind: 'page', n: 5 },
    },
  });

  // Watchdog reaps.
  await sweepStaleClaims();

  // Verify state.
  const reaped = await prisma.syncLog.findUniqueOrThrow({ where: { id: log.id } });
  expect(reaped.status).toBe('PENDING');
  expect(reaped.pageCursor).toEqual({ kind: 'page', n: 5 }); // ← cursor preserved

  // New worker claims.
  const claimed = await tryClaimNext('worker-replacement');
  expect(claimed?.id).toBe(log.id);
  expect(claimed?.pageCursor).toEqual({ kind: 'page', n: 5 }); // ← still preserved
  expect(claimed?.progressCurrent).toBe(500); // ← progress preserved
  expect(claimed?.attemptCount).toBe(2); // ← incremented
});
```

Import `tryClaimNext` from `@pazarsync/sync-core` and `sweepStaleClaims` from `'../../src/watchdog'`.

### E.4 — Retry policy backoff math + ceiling (T4 full) [MEDIUM PRIORITY]

**File:** `packages/sync-core/tests/integration/sync-log.service.test.ts` (CREATE — none exists yet)

**Test cases:**

```ts
import { prisma } from '@pazarsync/db';
import { syncLogService } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { createMembership, createOrganization, createStore, createUserProfile } from '../../../../apps/api/tests/helpers/factories';

describe('markRetryable backoff schedule', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });

  async function setupRow(attemptCount: number) {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    return prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        attemptCount,
        claimedAt: new Date(),
        claimedBy: 'w',
        lastTickAt: new Date(),
      },
    });
  }

  it.each([
    { attempt: 1, expectedBackoffSec: 30 },
    { attempt: 2, expectedBackoffSec: 60 },
    { attempt: 3, expectedBackoffSec: 120 },
    { attempt: 4, expectedBackoffSec: 240 },
    { attempt: 5, expectedBackoffSec: 480 },
    { attempt: 6, expectedBackoffSec: 960 },
    { attempt: 10, expectedBackoffSec: 1800 }, // capped at 30 min
  ])('attempt $attempt → next attempt in ~$expectedBackoffSec s', async ({ attempt, expectedBackoffSec }) => {
    const row = await setupRow(attempt);
    const before = Date.now();
    await syncLogService.markRetryable(row.id, attempt, 'TEST_ERROR', 'test');
    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id: row.id } });

    expect(after.status).toBe('FAILED_RETRYABLE');
    expect(after.claimedAt).toBeNull();
    expect(after.claimedBy).toBeNull();
    expect(after.nextAttemptAt).not.toBeNull();

    const actualSec = (after.nextAttemptAt!.getTime() - before) / 1000;
    expect(actualSec).toBeGreaterThan(expectedBackoffSec - 2);
    expect(actualSec).toBeLessThan(expectedBackoffSec + 2);
  });
});
```

The `MAX_ATTEMPTS = 5 → terminal FAIL` ceiling is enforced in `apps/sync-worker/src/index.ts:handleRunError`, not in `sync-log.service.ts`. Test it separately by mocking the runtime — or skip the ceiling test (the implementation is straightforward) and rely on integration coverage.

### E.5 — Graceful shutdown integration test (T7 full) [MEDIUM PRIORITY]

**Why:** The unit test in `apps/sync-worker/tests/unit/loop.test.ts` mocks the lifecycle. There's no proof the actual SIGTERM path works against the real DB.

**File:** `apps/sync-worker/tests/integration/shutdown.test.ts` (CREATE)

**Approach:** Don't actually spawn a worker subprocess — call `runSyncToCompletion` directly with a `shuttingDown` callback that flips between chunks.

```ts
import { prisma } from '@pazarsync/db';
import { encryptCredentials, syncLogService } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSyncToCompletion } from '../../src/loop';
import { productsHandler } from '../../src/handlers/products';
import { ensureDbReachable, truncateAll } from '../../../apps/api/tests/helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../../apps/api/tests/helpers/factories';

describe('graceful shutdown', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shuttingDown=true between chunks → row goes back to PENDING with cursor preserved', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Shutdown Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '2738',
        credentials: encryptCredentials({ supplierId: '2738', apiKey: 'k', apiSecret: 's' }),
      },
    });

    // Mock 3 pages — we'll shut down after page 1.
    const responses = [
      makeTrendyolResponse({ totalElements: 3, page: 0, contentId: 100 }),
      makeTrendyolResponse({ totalElements: 3, page: 1, contentId: 200 }),
      makeTrendyolResponse({ totalElements: 3, page: 2, contentId: 300 }),
    ];
    let pageIdx = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const r = responses[pageIdx++];
      return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const claimed = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-shutdown',
        lastTickAt: new Date(),
        attemptCount: 1,
      },
    });

    // shuttingDown returns false on first call (chunk 1 runs), true on second (loop exits).
    let calls = 0;
    await runSyncToCompletion(claimed, { PRODUCTS: productsHandler }, () => {
      const wasShuttingDown = calls > 0;
      calls += 1;
      return wasShuttingDown;
    });

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(after.status).toBe('PENDING'); // ← released, not RUNNING
    expect(after.claimedAt).toBeNull();
    expect(after.claimedBy).toBeNull();
    expect(after.progressCurrent).toBeGreaterThan(0); // ← chunk 1 committed
    expect(after.pageCursor).not.toBeNull(); // ← cursor saved for resumption
  });
});

// helpers same as in §D.3
```

### E.6 — Tests already done (T5, T6) — no action needed

T5 (Dashboard hoist) and T6 (Dedup) are covered. See audit §1.5.

---

## §F. Stretch goal — manual retry button (optional)

**Why useful:** Even with all the above fixes, a future Trendyol outage could leave a row in `FAILED_RETRYABLE` for hours of legitimate backoff. Users may want to force-retry now instead of waiting.

**Files:**
- `apps/api/src/routes/product.routes.ts` — new endpoint `POST /v1/.../products/sync/{syncLogId}/retry`. Body-less. Authorization: ensureOrgMember + verify SyncLog belongs to org. Behavior: if status is `FAILED_RETRYABLE`, set `nextAttemptAt = now()`. Returns 204. Otherwise 409 (e.g., row already RUNNING) or 422 (terminal).
- `apps/web/src/features/products/api/retry-product-sync.api.ts` (CREATE)
- `apps/web/src/features/products/hooks/use-retry-product-sync.ts` (CREATE)
- `apps/web/src/components/patterns/sync-center.tsx` — add "Şimdi yeniden dene" button to the `RetryingSyncItem`.

Skip this if §B–§E take longer than expected. The architecture supports it cleanly.

---

## §G. Recommended execution order

The dependencies between sections are:

```
§B Investigation (Step 1 only — verify worker is running)
       │
       ├─► §B Fix path A (start worker, watch resume)
       │
       └─► §C Observability (do this NEXT regardless of fix path)
                │
                ▼
            §D.1 Realtime wire shape organization_id
                │
                ▼
            §D.2 Optimistic UX
                │
                ▼
            §D.3 End-to-end test  ──┐
            §D.4 SyncCenter test ───┤
            §E.1 Multi-worker race  ├─► run all integration tests, verify green
            §E.2 Realtime RLS       │
            §E.3 Resume from cursor │
            §E.4 Backoff math       │
            §E.5 Graceful shutdown ─┘
                │
                ▼
            §F Manual retry (optional)
```

Each numbered subsection is one PR if you're using subagent-driven-development, or one commit if inline. Before opening any PR, run `pnpm check:full` to mirror CI. Always ask the user before `git commit` (project rule — do not auto-commit).

---

## §H. Verification checklist (run before declaring "done")

- [ ] **§B**: Trigger a sync. Worker claims within 1 s. Progress ticks. Sync completes. The previously-stuck row in `FAILED_RETRYABLE` either resumed automatically when worker started, or you manually moved it.
- [ ] **§B**: `pnpm dev` from repo root starts API + web + worker.
- [ ] **§C**: Trigger a sync, watch worker stdout. Every state transition is a structured log. A deliberate failure (revoke creds) shows `chunk.start → content.upsert.failed → worker.run.error → sync.retryable` chain.
- [ ] **§D.1**: `applyEvent` produces a `SyncLog` with `organizationId` populated. Component test covers it.
- [ ] **§D.2**: Click "Senkronize Et" → SyncCenter immediately shows "Kuyrukta" badge. Within 1 s, transitions to "Çalışıyor". No flicker.
- [ ] **§D.3**: `pnpm --filter @pazarsync/sync-worker test:integration` includes `end-to-end.test.ts` and passes.
- [ ] **§D.4**: `pnpm --filter web test:component sync-center` exists and passes.
- [ ] **§E.1**: Multi-worker race test passes — exactly one of two simultaneous `tryClaimNext` calls returns the row.
- [ ] **§E.2**: Realtime tenant isolation test passes — user A's channel never receives org B's events.
- [ ] **§E.3**: Cursor-resumption test passes — watchdog reap → next claim preserves `pageCursor`.
- [ ] **§E.4**: Backoff schedule test passes for 7 attempt counts.
- [ ] **§E.5**: Graceful shutdown test passes — chunk completes, row returns to `PENDING` with cursor.
- [ ] **`pnpm check:full`** passes from repo root (typecheck + lint + all tests + format).
- [ ] **Two-tab smoke test**: Tab A on `/dashboard`, Tab B on `/products`. Trigger sync from B. SyncBadge in A's header lights up within ~1 s.
- [ ] **Restart resilience smoke test**: Trigger sync. Mid-run, kill worker (`Ctrl-C`). Restart worker. Sync resumes from saved cursor without re-running done pages.

---

## §I. Project conventions you must follow (from CLAUDE.md and project memory)

These are not optional:

- **Branch + PR for everything.** Never commit directly to main. Use `feat/...`, `fix/...`, `refactor/...`, `chore/...` branches.
- **Ask before every `git commit`** — even in auto mode, never auto-commit. Project memory rule.
- **Conventional commits** (`feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`, `chore(...)`) with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` at the bottom.
- **Run `/simplify` and `/postgres` (or `/vercel-react-best-practices` for frontend) on changed code** before `pnpm check:all`.
- **`pnpm check:all`** must pass before every commit (typecheck + lint + unit + format).
- **`pnpm check:full`** must pass before opening a PR (above + integration tests).
- **Every new org-scoped endpoint needs a tenant-isolation test** under `apps/api/tests/integration/tenant-isolation/`. No exceptions.
- **RLS policies ship in the same PR as their feature**, never deferred.
- **Never use `prisma db push --force-reset`** — it loses Supabase platform `GRANT`s and breaks integration tests with `42501`.
- **No `--no-verify` git flags.** Hooks exist for a reason.

---

## §J. If you get stuck

The audit (`docs/audits/2026-04-28-sync-plan-audit.md`) §5 lists 6 plausible runtime-error sources. The bug in §B above matches §5 item 3 ("Worker process not running locally"). If you find a different symptom, cross-reference the audit's list before chasing a new hypothesis.

The plan (`docs/plans/2026-04-27-sync-engine-architecture-implementation.md`) has the full per-step code for everything that already shipped. If something looks weird in the codebase, compare against the plan's expected shape — it's still authoritative for what was supposed to happen.

The spec (`docs/plans/2026-04-27-sync-engine-architecture-design.md`) is the contract. If you find yourself wanting to deviate, write it down and surface it to the user before doing it.

Good luck.
