# Sync Engine v2 — Plan-vs-Implementation Audit

**Date:** 2026-04-28
**Auditor:** Claude (independent verification, ground-truth read of code on `main`)
**Scope:** `docs/plans/2026-04-27-sync-engine-architecture-design.md` (spec) + `docs/plans/2026-04-27-sync-engine-architecture-implementation.md` (PR-by-PR plan), spanning PRs #60, #61, #62, #64, #65, plus the post-merge follow-ups #66, #67, #68, #69 that landed before this audit.

**Method:** Re-read both planning documents end-to-end. Built an independent approved-scope checklist. Verified each item against the actual files on `main` (HEAD: `9d0dc5c`) using direct `Read`, `grep`, and DB introspection. Ran the full test suite to confirm green baseline.

**Test baseline verified at audit time:**

| Suite                                      | Count     |
| ------------------------------------------ | --------- |
| `@pazarsync/api` unit                      | 113 ✓     |
| `@pazarsync/api` integration               | 134 ✓     |
| `@pazarsync/sync-core` integration (claim) | 4 ✓       |
| `@pazarsync/sync-worker` unit              | 4 ✓       |
| `@pazarsync/sync-worker` integration       | 4 ✓       |
| `web`                                      | 210 ✓     |
| **Total**                                  | **469 ✓** |

---

## Executive summary

**The previous session's claim that "the plan is fully complete" is approximately true for delivered code structure, but materially false for the test contract from spec §12.**

- **Code structure (files, services, hooks, routes, schema):** ~95% delivered.
- **Tests required by spec §12:** 4 of 7 missing or only partially covered.
- **Wire-shape deviation in the Realtime layer:** missing field that the plan explicitly called out.
- **Three real bugs that shipped with PR #65 and were caught only post-merge** (PRs #66, #67, #68). All fixed, but they reveal a class of regressions the deferred tests would have caught.

The runtime errors the user is seeing in practice are almost certainly NOT in the architectural skeleton — that part is solid. They are most likely in the integration seams that no test covers: end-to-end claim→process→complete on a real Trendyol store, Realtime channel evaluation under RLS, multi-worker SKIP LOCKED behavior, or graceful shutdown.

---

## 1. Approved scope checklist

Built independently from spec §1–13 + plan PRs 1–5. Each item annotated with implementation status.

### PR 1 — `organization_id` on `sync_logs` for Realtime-friendly RLS

| #   | Item                                                                                      | Status   | Evidence                                                                               |
| --- | ----------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| 1.1 | `SyncLog.organizationId` column (UUID, NOT NULL)                                          | **Done** | `packages/db/prisma/schema.prisma:355`; DB column verified `organization_id uuid (NO)` |
| 1.2 | FK to `Organization` with `onDelete: Cascade`                                             | **Done** | schema.prisma SyncLog model includes `organization Organization @relation(...)`        |
| 1.3 | `Organization → SyncLog` reverse relation                                                 | **Done** | schema.prisma Organization model includes `syncLogs SyncLog[]`                         |
| 1.4 | Index on `organizationId`                                                                 | **Done** | DB: `sync_logs_organization_id_idx`                                                    |
| 1.5 | RLS policy `sync_logs_org_member_read` rewritten to flat `is_org_member(organization_id)` | **Done** | DB pg_policy: `is_org_member(organization_id)`                                         |
| 1.6 | `acquireSlot()` takes `organizationId` and stamps it on insert                            | **Done** | `packages/sync-core/src/sync-log.service.ts:66-99`                                     |
| 1.7 | `product.routes.ts` passes `organizationId` to `acquireSlot`                              | **Done** | `apps/api/src/routes/product.routes.ts:102`                                            |

### PR 2 — Schema additions for the new state machine

| #    | Item                                                                                                                                           | Status                  | Evidence                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 2.1  | `SyncStatus` enum gains `PENDING` + `FAILED_RETRYABLE`                                                                                         | **Done**                | DB enum range: `RUNNING, COMPLETED, FAILED, PENDING, FAILED_RETRYABLE`                                        |
| 2.2  | `claimedAt: timestamptz`                                                                                                                       | **Done with deviation** | DB column is `timestamp` (no TZ); Prisma's `DateTime` default. Cosmetic vs spec; consistent with sibling cols |
| 2.3  | `claimedBy: text`                                                                                                                              | **Done**                | column verified                                                                                               |
| 2.4  | `lastTickAt: timestamptz`                                                                                                                      | **Done with deviation** | same TZ note as 2.2                                                                                           |
| 2.5  | `pageCursor: jsonb`                                                                                                                            | **Done**                | column verified `page_cursor jsonb (YES)`                                                                     |
| 2.6  | `attemptCount: int default 0`                                                                                                                  | **Done**                | column verified `attempt_count integer (NO)`                                                                  |
| 2.7  | `nextAttemptAt: timestamptz`                                                                                                                   | **Done with deviation** | same TZ note                                                                                                  |
| 2.8  | Partial unique index `sync_logs_active_slot_uniq ON (store_id, sync_type) WHERE status IN ('PENDING','RUNNING','FAILED_RETRYABLE')`            | **Done**                | DB: indexdef matches verbatim                                                                                 |
| 2.9  | Index `[status, nextAttemptAt]`                                                                                                                | **Done**                | DB: `sync_logs_status_next_attempt_at_idx`                                                                    |
| 2.10 | `apps/api/tests/integration/services/sync-log.dedup.test.ts` (3 cases: rejects 2nd active, allows after COMPLETED, allows different syncTypes) | **Done**                | file present; 3 `it(...)` blocks verified                                                                     |

### PR 3 — Code extraction (`packages/marketplace`, `packages/sync-core`)

| #   | Item                                                                                                        | Status   | Evidence                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| 3.1 | `packages/marketplace/` scaffolded                                                                          | **Done** | `package.json`, `tsconfig.json`, `src/index.ts` present                                                  |
| 3.2 | Marketplace adapter code moved from `apps/api`                                                              | **Done** | `apps/api/src/integrations/marketplace` does NOT exist on main                                           |
| 3.3 | `packages/sync-core/` scaffolded                                                                            | **Done** | `package.json`, `tsconfig.json`, `src/index.ts` present                                                  |
| 3.4 | `sync-log.service.ts` moved                                                                                 | **Done** | `apps/api/src/services/sync-log.service.ts` deleted; `packages/sync-core/src/sync-log.service.ts` exists |
| 3.5 | `crypto.ts` moved                                                                                           | **Done** | `apps/api/src/lib/crypto.ts` deleted; `packages/sync-core/src/crypto.ts` exists                          |
| 3.6 | `map-prisma-error.ts` moved                                                                                 | **Done** | `apps/api/src/lib/map-prisma-error.ts` deleted; `packages/sync-core/src/map-prisma-error.ts` exists      |
| 3.7 | Sync-specific errors split into `packages/sync-core/src/errors.ts`; `apps/api/src/lib/errors.ts` re-exports | **Done** | error classes present in sync-core; api re-export verified                                               |
| 3.8 | `apps/api` imports updated throughout                                                                       | **Done** | no relative imports to moved paths remain                                                                |
| 3.9 | Pure refactor — no behavior change                                                                          | **Done** | post-PR-3 test count unchanged                                                                           |

### PR 4 — Worker app + API cutover

| #           | Item                                                                                                                                                      | Status                    | Evidence                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4a.1        | `packages/sync-core/src/claim.ts` with `tryClaimNext` using SKIP LOCKED                                                                                   | **Done**                  | `claim.ts:19-42` uses 2-step transaction (cleaner than plan's first proposal)                                                                        |
| 4a.2        | `packages/sync-core/tests/integration/claim.test.ts` with 4 cases                                                                                         | **Done**                  | file present; 4 `it(...)` blocks verified                                                                                                            |
| 4b.1        | `packages/sync-core/src/checkpoint.ts` with Zod parsers (`PageIndexCursorSchema`, `PageTokenCursorSchema`, `ProductsCursorSchema`, `parseProductsCursor`) | **Done**                  | `checkpoint.ts:1-33`                                                                                                                                 |
| 4c.1        | `apps/sync-worker/{package.json, tsconfig.json, vitest.config.ts}` scaffolded                                                                             | **Done**                  | all present                                                                                                                                          |
| 4c.2        | `apps/sync-worker/src/handlers/types.ts` (`ModuleHandler`, `ChunkResult` discriminated union)                                                             | **Done**                  | file present                                                                                                                                         |
| 4c.3        | `apps/sync-worker/src/dispatcher.ts` with `decodeCursor` exhaustive switch                                                                                | **Done**                  | `dispatcher.ts:1-35`; exhaustive `default: never` guard verified                                                                                     |
| 4c.4        | `apps/sync-worker/tests/unit/dispatcher.test.ts` with 2 cases                                                                                             | **Done**                  | file present; 2 `it(...)` blocks verified                                                                                                            |
| 4d.1        | `apps/sync-worker/src/handlers/products.ts` (`processProductsChunk`, `upsertBatch` ported)                                                                | **Done**                  | file present; upsertBatch ported verbatim from legacy `productSyncService.run`                                                                       |
| 4d.2        | `fetchApprovedProducts` accepts `initialCursor`                                                                                                           | **Done**                  | `packages/marketplace/src/trendyol/products.ts:170-211`                                                                                              |
| 4d.3        | `apps/sync-worker/tests/integration/products-handler.test.ts` with 2 cases                                                                                | **Done**                  | file present                                                                                                                                         |
| 4e.1        | `apps/sync-worker/src/loop.ts` (`runSyncToCompletion`)                                                                                                    | **Done**                  | `loop.ts:1-57`                                                                                                                                       |
| 4e.2        | `apps/sync-worker/tests/unit/loop.test.ts` with 2 cases                                                                                                   | **Done**                  | file present                                                                                                                                         |
| 4f.1        | `apps/sync-worker/src/watchdog.ts` (`sweepStaleClaims`, 90 s threshold)                                                                                   | **Done with improvement** | `watchdog.ts:1-27`; uses parameterized `Date` instead of plan's SQL string interpolation — strictly better                                           |
| 4f.2        | `apps/sync-worker/tests/unit/watchdog.test.ts` (plan called for both unit + integration)                                                                  | **Missing**               | only `tests/integration/watchdog.test.ts` exists                                                                                                     |
| 4f.3        | `apps/sync-worker/tests/integration/watchdog.test.ts` with 2 cases                                                                                        | **Done**                  | file present; 2 `it(...)` blocks                                                                                                                     |
| 4g.1        | `apps/sync-worker/src/index.ts` entry point                                                                                                               | **Done**                  | matches plan with improvement (`PERMANENT_FAILURE_CODES` as `ReadonlySet`)                                                                           |
| 4g.2        | Polling adaptive backoff 100 ms → 5 s                                                                                                                     | **Done**                  | `index.ts:42,43`                                                                                                                                     |
| 4g.3        | `WATCHDOG_INTERVAL_MS = 30_000`                                                                                                                           | **Done**                  | `index.ts:45`                                                                                                                                        |
| 4g.4        | `MAX_ATTEMPTS = 5`                                                                                                                                        | **Done**                  | `index.ts:46`                                                                                                                                        |
| 4g.5        | SIGTERM/SIGINT handlers flip `shuttingDown`                                                                                                               | **Done**                  | `index.ts:70-77`                                                                                                                                     |
| 4g.6        | Error classification: AUTH/ACCESS/CORRUPT → `fail`, else → `markRetryable`, attempt > MAX → `fail`                                                        | **Done**                  | `index.ts:116-135`                                                                                                                                   |
| 4h.1        | `acquireSlot` rewritten: pure INSERT + P2002 catch with `existingSyncLogId` in meta                                                                       | **Done**                  | `packages/sync-core/src/sync-log.service.ts:66-99`; uses duck-typed `isUniqueViolation` (cleaner than plan's `Prisma.PrismaClientKnownRequestError`) |
| 4h.2        | `tick`, `releaseToPending`, `markRetryable` added to sync-core                                                                                            | **Done**                  | sync-log.service.ts:224, :244, :271                                                                                                                  |
| 4h.3        | `markRetryable` backoff: `30_000 × 2^(attemptCount-1)`, capped at 30 min                                                                                  | **Done**                  | sync-log.service.ts:273; verified formula matches                                                                                                    |
| 4h.4        | `apps/api/src/routes/product.routes.ts` drops `runInBackground`, INSERTs PENDING, returns `{ syncLogId, status: 'PENDING', enqueuedAt }`                  | **Done**                  | product.routes.ts:92-112                                                                                                                             |
| 4h.5        | `apps/api/src/lib/run-in-background.ts` deleted                                                                                                           | **Done**                  | file does not exist on main                                                                                                                          |
| 4h.6        | `apps/api/src/services/product-sync.service.ts` deleted                                                                                                   | **Done**                  | file does not exist on main                                                                                                                          |
| 4h.7        | `apps/api/tests/integration/services/product-sync.service.test.ts` deleted                                                                                | **Done**                  | file does not exist on main                                                                                                                          |
| 4h.8        | `apps/api/tests/integration/routes/product.routes.test.ts` updated to assert `'PENDING'` + `existingSyncLogId` in 409                                     | **Done**                  | both assertions present                                                                                                                              |
| 4h.9        | OpenAPI regenerated (`packages/api-client/openapi.json`) — `StartSyncResponse.status: 'PENDING'`, `enqueuedAt` field                                      | **Done**                  | openapi.json schema verified                                                                                                                         |
| 4i.1        | `packages/db/scripts/cutover-stale-running.ts`                                                                                                            | **Done**                  | matches plan; idempotent `WHERE status = 'RUNNING' AND claimed_at IS NULL`                                                                           |
| 4i.2        | `packages/db/package.json` `cutover:v2` script                                                                                                            | **Done**                  | script present                                                                                                                                       |
| 4i.3        | `apps/sync-worker/Dockerfile`                                                                                                                             | **Done with improvement** | adds `tsconfig.base.json` to COPY, documents required runtime env, build context note                                                                |
| **MISSING** | `apps/sync-worker/tests/integration/end-to-end.test.ts` (full enqueue → claim → process → complete)                                                       | **Missing**               | plan §4 file list line 840; not in tree                                                                                                              |

### PR 5 — Frontend hoist (org-wide subscription in dashboard layout)

| #    | Item                                                                                              | Status                   | Evidence                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 5a.1 | `GET /v1/organizations/:orgId/sync-logs` route                                                    | **Done**                 | `apps/api/src/routes/sync-log.routes.ts:38-76`                                                                              |
| 5a.2 | Mounted in `apps/api/src/app.ts`                                                                  | **Done**                 | `app.ts:16,124`                                                                                                             |
| 5a.3 | `listOrgActiveAndRecent` in sync-core                                                             | **Done**                 | `packages/sync-core/src/sync-log.service.ts:160`                                                                            |
| 5a.4 | Org-scoped tenant-isolation test                                                                  | **Done**                 | `apps/api/tests/integration/tenant-isolation/sync-logs-org.test.ts` (3 cases)                                               |
| 5b.1 | `subscribeToOrgSyncs` in `apps/web/src/lib/supabase/realtime.ts`                                  | **Done**                 | function present, filters `organization_id=eq.<orgId>`                                                                      |
| 5b.2 | Wire shape `SyncLogsRowWire` includes `organization_id`                                           | **NOT DONE — DEVIATION** | column NOT on wire shape; plan explicitly required this                                                                     |
| 5b.3 | `SyncLogRealtimeShape` includes `organizationId`                                                  | **NOT DONE — DEVIATION** | shape NOT extended                                                                                                          |
| 5b.4 | `snakeToCamel` maps it                                                                            | **N/A**                  | field absent from both shapes                                                                                               |
| 5c.1 | `apps/web/src/features/sync/providers/org-syncs-provider.tsx` (`OrgSyncsProvider`, `useOrgSyncs`) | **Done**                 | file present; provider + hook verified                                                                                      |
| 5c.2 | `apps/web/src/features/sync/hooks/use-org-syncs.ts` (separate hook file per plan)                 | **Deviation (cosmetic)** | `useOrgSyncs` exported from the provider file instead; consumers import from `org-syncs-provider`, no functional difference |
| 5c.3 | `useStoreSyncs` derived view at `apps/web/src/features/sync/hooks/use-store-syncs.ts`             | **Done**                 | file present                                                                                                                |
| 5c.4 | `apps/web/src/features/sync/api/list-org-sync-logs.api.ts`                                        | **Done**                 | file present                                                                                                                |
| 5c.5 | `apps/web/src/features/sync/query-keys.ts`                                                        | **Done**                 | file present                                                                                                                |
| 5c.6 | `OrgSyncsProvider` mounted in `(dashboard)/layout.tsx`                                            | **Done**                 | layout.tsx:39 wraps children                                                                                                |
| 5c.7 | Polling-gate logic (refetchInterval returns false when health=`healthy`)                          | **Done — added in #66**  | provider.tsx:80-85                                                                                                          |
| 5c.8 | Recovery edge: `errored`/`paused` → `healthy` triggers `invalidateQueries`                        | **Done — added in #66**  | provider.tsx:104-107                                                                                                        |
| 5d.1 | `SyncBadge` extended for N=0 / N=1 / N≥2                                                          | **Done — fixed in #67**  | original PR-65 had `if (activeCount === 0) return null` regression; #67 fixed                                               |
| 5d.2 | New `'retrying'` `SyncState` with warning tone                                                    | **Done — added in #68**  | `sync-badge.tsx:25`                                                                                                         |
| 5e.1 | `SyncCenter` cross-store grouping                                                                 | **Done**                 | sync-center groups by storeId                                                                                               |
| 5e.2 | `SyncCenter` retrying section                                                                     | **Done — added in #68**  | `sync-center.tsx:130-135` three-bucket split                                                                                |
| 5e.3 | Manual sync button disabled while ANY active-slot row exists                                      | **Done — added in #68**  | sync-center.tsx:170                                                                                                         |
| 5f.1 | `products-page-client.tsx` migrated from `useActiveSyncLogs` to `useStoreSyncs`                   | **Done**                 | products-page-client.tsx:65                                                                                                 |
| 5f.2 | `apps/web/src/features/products/hooks/use-active-sync-logs.ts` deleted                            | **Done**                 | file does not exist                                                                                                         |
| 5f.3 | `apps/web/tests/unit/hooks/use-active-sync-logs.test.tsx` deleted                                 | **Done**                 | file does not exist                                                                                                         |
| 5g.1 | `apps/web/tests/unit/features/sync/use-org-syncs.test.tsx`                                        | **Done**                 | file present                                                                                                                |
| 5g.2 | `apps/web/tests/unit/features/sync/use-store-syncs.test.tsx`                                      | **Done**                 | file present                                                                                                                |
| 5g.3 | `useStartProductSync` invalidates `orgSyncKeys.list(orgId)` on success (optimistic)               | **Done**                 | `use-start-product-sync.ts:39-44`                                                                                           |

### Spec §12 — Tests required

| #   | Test                                                                                              | Status                                                 | Evidence                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Tenant isolation: sync from org A invisible in org B's Realtime channel**                       | **Partially done — REST only, NOT Realtime**           | `sync-logs-org.test.ts` covers REST endpoint + RLS. No test exercises Supabase Realtime postgres_changes filter. The frontend `useOrgSyncs.test.tsx` mocks the realtime layer.                                                            |
| T2  | **Worker concurrency: 2 workers race for same row, only 1 claims**                                | **MISSING**                                            | `claim.test.ts` only verifies single-worker behavior. The SKIP LOCKED branch is unverified.                                                                                                                                               |
| T3  | **Crash recovery: kill mid-chunk → watchdog requeues → resume from cursor**                       | **Partially done — requeue half only**                 | `watchdog.test.ts` verifies stale rows are reset to PENDING. No test verifies the resumed claim picks up from saved `pageCursor`.                                                                                                         |
| T4  | **Retry policy: marketplace 5xx → FAILED_RETRYABLE → next attempt**                               | **Partially done**                                     | `claim.test.ts` verifies a FAILED_RETRYABLE row with elapsed `nextAttemptAt` is claimable. No test verifies the markRetryable backoff schedule, attempt-counter ceiling, or that 5xx errors actually transition through FAILED_RETRYABLE. |
| T5  | **Dashboard hoist: any user any dashboard route sees sync triggered by another user**             | **Done**                                               | `use-org-syncs.test.tsx` + `use-store-syncs.test.tsx` cover the hoisted-channel cache update path                                                                                                                                         |
| T6  | **Dedup: 2 concurrent POSTs → one 202, one 409 with `existingSyncLogId`**                         | **Done**                                               | `sync-log.dedup.test.ts` covers the unique-index. `product.routes.test.ts` covers the 409 response shape.                                                                                                                                 |
| T7  | **Graceful shutdown: SIGTERM mid-chunk → chunk completes → row to PENDING → next worker resumes** | **Partially done — unit only, no resume verification** | `loop.test.ts` mock-tests the `shuttingDown` → `releaseToPending` flow. No integration test verifies the SIGTERM-while-running scenario, nor that the next worker resumes from the cursor.                                                |

**Tally: 2 of 7 done, 4 partial, 1 missing entirely.**

---

## 2. Unapproved changes (post-PR-65 follow-ups)

Four PRs landed after PR #65 but before this audit. None were in the original plan; all addressed real bugs:

| PR  | Title                                                               | What it fixed                                                                                                                                                 | Why it shipped                                                                                                                                                           |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #66 | polling-cost reduction + transient Trendyol retries (port from #59) | Realtime channel health-tracking + 5xx fetch-retry. Original PR-65 didn't include either.                                                                     | Without health tracking, the dashboard polled `/sync-logs` every 2 s during syncs even though Realtime was already pushing updates.                                      |
| #67 | render single-sync surface when activeCount is 0                    | Dropped the `if (activeCount === 0) return null` that PR-65 introduced.                                                                                       | Products page header was empty (no SyncBadge, no SyncCenter entry point) on every page load with no active sync.                                                         |
| #68 | surface FAILED_RETRYABLE state in SyncCenter + badge                | Widened wire shape to 5-status enum, added `attempt_count`/`next_attempt_at` to the wire, added retrying section to SyncCenter, added `'retrying'` SyncState. | Real Trendyol outage during a 5,636-row sync left the dashboard at "44%" with no visible signal — DB row was FAILED_RETRYABLE but the frontend silently filtered it out. |
| #69 | serialize integration tests across packages                         | Test DB races between `@pazarsync/api` integration tests and `@pazarsync/sync-core` integration tests.                                                        | Both suites run against the same local Supabase + same `truncateAll()` and racing them flushed each other's data.                                                        |

**Each of #66/#67/#68 is a class of regression the deferred tests in §1 above would have prevented:**

- #67 would have been caught by a SyncBadge component test asserting visibility at `activeCount=0`. (PR #67 itself added 6 such tests — proving they were absent before.)
- #68 would have been caught by a SyncCenter component test rendering a `FAILED_RETRYABLE` row and asserting the retry section + retry-time label. PR #68 explicitly deferred this test ("Future follow-up: add a regression test for SyncCenter that asserts FAILED_RETRYABLE rows render in the retrying section").
- #66 would have been caught by an end-to-end test asserting that during an active sync, no `/sync-logs` REST polls fire while Realtime is healthy. The deferred end-to-end test (4d step missing) is exactly this.

---

## 3. Items that diverged from the plan

Listed in order of magnitude:

### 3.1 Realtime wire shape missing `organization_id` — DEVIATION

**Plan said** (§9 / step 9 of PR 5c, Note):

> "the `subscribeToOrgSyncs` event payload needs `organizationId` in the wire shape. Add it to `SyncLogsRowWire` and `SyncLogRealtimeShape` in `realtime.ts` (it's already in the DB column from PR 1)."

**What landed:** `SyncLogsRowWire` (apps/web/src/lib/supabase/realtime.ts:13–39) does NOT include `organization_id`. `SyncLogRealtimeShape` (line 41–56) does NOT include `organizationId`. `snakeToCamel` (line 74–91) doesn't map it.

**Functional impact:** None observable today. Supabase Realtime applies the channel filter `organization_id=eq.<orgId>` server-side, and RLS gates the row. Cross-org leakage at the channel layer is prevented by both.

**Latent risk:** Defense-in-depth on the client is missing. If the channel filter ever drifts (e.g., a refactor switches to broadcast or removes the filter), there is no client-side guard verifying the row's `organizationId`. Also, applyEvent's reconstruction of `SyncLog` (provider.tsx:146-161) silently doesn't include `organizationId`, so any consumer that filters by it on the in-memory cache (none today, but future code) gets `undefined`.

**Recommended fix:** Add `organization_id` to `SyncLogsRowWire`, `organizationId` to `SyncLogRealtimeShape`, map it in `snakeToCamel`, and (optionally) widen `SyncLogResponse` in the API contract so the consumer's `SyncLog` type carries it.

### 3.2 `useOrgSyncs` lives in the provider file, not a separate hook file — COSMETIC

**Plan said:** Create `apps/web/src/features/sync/hooks/use-org-syncs.ts`.

**What landed:** `useOrgSyncs` is exported from `apps/web/src/features/sync/providers/org-syncs-provider.tsx:126`.

**Functional impact:** None. Imports work; both `useStoreSyncs` and `(dashboard)/layout.tsx` reference it correctly.

**Verdict:** Acceptable; co-locating a hook with its provider is a common pattern.

### 3.3 Watchdog has integration test only, not unit — DEFENSIBLE

**Plan said:** Both `apps/sync-worker/tests/unit/watchdog.test.ts` and `apps/sync-worker/tests/integration/watchdog.test.ts`.

**What landed:** Only the integration test (covers both the "stale → PENDING" and "fresh untouched" paths).

**Functional impact:** None. Pure-unit watchdog testing would mock Prisma, which adds little signal beyond what the integration test already proves.

**Verdict:** Acceptable.

### 3.4 Schema column type `timestamp` instead of `timestamptz` — INHERITED

**Plan said:** `claimedAt: timestamptz` etc.

**What landed:** Prisma's `DateTime` defaults to `timestamp without time zone`. The new columns match the existing `started_at`/`completed_at` columns, which were already `timestamp`.

**Functional impact:** All Postgres timestamp comparisons happen in UTC anyway via `now()`. The watchdog SQL passes a JS `Date` (UTC) and compares against `last_tick_at`; Prisma serializes to ISO timestamps. No observable bug.

**Latent risk:** If someone ever inserts a non-UTC timestamp via raw SQL, the comparison semantics differ from `timestamptz`. None of our paths do this.

**Verdict:** Acceptable; matches the rest of the schema.

### 3.5 Code-quality improvements over the plan (not deviations, but worth noting)

- `tryClaimNext` uses the cleaner 2-step transaction Prisma pattern (plan suggested this as "cleaner alternative" — they took it).
- Watchdog uses parameterized `Date` instead of plan's interpolated SQL string — strictly safer.
- `acquireSlot` duck-types the P2002 check via `'code' in err && err.code === 'P2002'` instead of importing the `Prisma` namespace — avoids a generated-type dependency.
- `PERMANENT_FAILURE_CODES` is a `ReadonlySet<string>` instead of inline `if` chain — more readable.
- Dockerfile additions: `tsconfig.base.json` in COPY (necessary for type resolution at build), runtime env documentation, build-context note.

---

## 4. What's still missing (gaps)

In priority order — these are the items the user might want to ship:

### G1. End-to-end integration test [HIGH PRIORITY]

**Plan §PR-4 file list, line 840:** `apps/sync-worker/tests/integration/end-to-end.test.ts` — full enqueue → claim → process → complete.

**Why it matters:** This is the single most important test for proving the architecture works as a system. None of the existing tests run the full path: API inserts PENDING → worker claims → worker processes a chunk → worker ticks progress → worker completes. Each piece is unit-tested in isolation; their composition is not. **This is the test most likely to surface the "errors in practice" the user mentions.**

### G2. Multi-worker concurrency test [HIGH PRIORITY]

**Spec §12 T2:** Two workers race for the same row; one claims; the other sees `null` and moves on.

**Why it matters:** The whole "scale out by adding workers" claim hinges on `SELECT … FOR UPDATE SKIP LOCKED` working. The current `claim.test.ts` runs a single `tryClaimNext` call against a populated DB; the racing branch is unverified. A regression that broke SKIP LOCKED (e.g., refactoring to `findFirst` + `update`) would not be caught by the existing tests.

**Test sketch:**

```ts
it('two simultaneous workers cannot both claim the same PENDING row', async () => {
  // seed one PENDING row
  const [a, b] = await Promise.all([tryClaimNext('w-A'), tryClaimNext('w-B')]);
  expect([a, b].filter((x) => x !== null)).toHaveLength(1);
});
```

### G3. Realtime tenant-isolation test [HIGH PRIORITY for security]

**Spec §12 T1:** A sync started by org A is not visible in org B's Realtime channel.

**Why it matters:** This is the _Realtime path_, not REST. The existing `sync-logs-org.test.ts` covers REST + RLS. The frontend `use-org-syncs.test.tsx` mocks the realtime layer entirely. If RLS on `sync_logs` ever regressed (e.g., reverted to the pre-PR-60 cross-table EXISTS), the channel would either crash (a noisy regression) or — worse — leak rows across orgs. Neither is covered.

**Test sketch:** Use Supabase JS with two different scoped clients (mirrors the pattern in `tests/integration/rls/`) to subscribe to `sync_logs:org:<a>`, INSERT a row in org B via Prisma superuser, assert the channel did NOT deliver it within a timeout.

### G4. Resume-from-cursor verification [MEDIUM PRIORITY]

**Spec §12 T3 (second half):** After watchdog requeues, "another worker resumes from saved cursor."

**Why it matters:** The whole point of `pageCursor` is resumability after a crash. The existing watchdog test verifies the row goes to PENDING but does not verify that the next claim actually starts from the saved cursor. A bug in `decodeCursor` or `parseProductsCursor` that defaulted to `null`/page-0 on resume would not be caught.

**Test sketch:** Seed a `RUNNING` row with `pageCursor: { kind: 'page', n: 5 }` and old `lastTickAt`. Run `sweepStaleClaims()` then `tryClaimNext()`. Assert the claimed row's cursor is preserved.

### G5. SIGTERM mid-chunk integration test [MEDIUM PRIORITY]

**Spec §12 T7:** SIGTERM mid-chunk → chunk completes → row to PENDING → next worker resumes.

**Why it matters:** Deploys are the most common reason a worker dies mid-run. The unit test verifies the in-process logic with mocks; it doesn't catch a regression where the actual SIGTERM path doesn't reach `releaseToPending` (e.g., if a future refactor adds an early return inside the chunk loop).

**Test sketch:** Spawn the worker process, INSERT a PENDING row that will take >1 chunk, send SIGTERM, assert the row is back to PENDING with cursor preserved.

### G6. Retry-policy backoff verification [MEDIUM PRIORITY]

**Spec §12 T4 (full):** marketplace 5xx exhausts retries → FAILED_RETRYABLE → next attempt fires after backoff window.

**Why it matters:** The backoff formula `30_000 × 2^(attemptCount-1)` capped at 30 min is in `markRetryable` but no test verifies it computes the right `nextAttemptAt`, nor that the `MAX_ATTEMPTS=5` ceiling works (transitions to terminal `FAILED` after 5).

### G7. SyncCenter component regression test [LOW-MEDIUM PRIORITY]

**Explicit deferred follow-up from PR #68:** "Add a regression test for SyncCenter that asserts FAILED_RETRYABLE rows render in the retrying section with the error code and retry timing."

**Why it matters:** PR #68 fixed the user-visible bug ("dashboard stuck at 44% with no signal") by widening the wire shape and adding the retrying section. Without a test, the next refactor could re-collapse the buckets and the same regression silently ships. This is the highest-leverage frontend test missing.

### G8. Sync-worker not in CI's recursive test runner [LOW PRIORITY]

The CI workflow runs API + web. `pnpm -r test:unit` likely covers sync-worker, but I did not verify by inspecting the CI YAML for an explicit guard. Worth a one-line check.

---

## 5. Plausible runtime-error sources (independent hypothesis)

Without seeing your specific errors yet, these are the seams most likely to fail in practice given the audit findings:

1. **Trendyol stage flake during a real sync → user sees "Bir şey ters gitti"-style toast then nothing.**
   PR #68 was meant to fix this (FAILED_RETRYABLE now visible). But: no end-to-end test verifies the path actually surfaces correctly, and the wire shape was extended without a regression test. If the API's `SyncLogResponse` mapper ever drops `attempt_count`/`next_attempt_at`, the retrying badge silently disappears.

2. **First post-trigger render shows nothing, then pops in ~1 s later.**
   The optimistic invalidation in `useStartProductSync` fires `invalidateQueries` (refetch) on success. The 202 response carries `status: 'PENDING'` but the mutation onSuccess does NOT do an optimistic `setQueryData` insert; it relies on the subsequent refetch + the eventual Realtime UPDATE to status=RUNNING. The plan called for `setQueryData(orgSyncsKeys.active, prev => [pendingRow, ...prev])` (spec §9 "Optimistic trigger UX") — this was NOT implemented. So there is a brief render gap.

3. **Worker process not running locally → click does nothing visible.**
   With the v2 architecture, the API only writes PENDING. If the user runs `pnpm dev --filter api` + `pnpm dev --filter web` but NOT `pnpm dev --filter @pazarsync/sync-worker`, the row sits in PENDING forever. Watchdog never reclaims because `lastTickAt` is null on PENDING. UI shows "Kuyrukta" indefinitely. Easy to hit during local dev.

4. **Realtime channel doesn't reach `healthy` → polling fallback fires every 10 s instead.**
   PR #66 added health-tracking, but only with one path to `healthy` (`SUBSCRIBED` event). If for any reason the WS handshake fails (auth token drift, RLS regression, schema drift after a reset), the consumer falls back to 10 s polling — visible in DevTools as a steady drumbeat of `/sync-logs` calls.

5. **Cross-tab re-mount on focus change → multiple channels per user briefly.**
   Visibility hook in `subscribeToOrgSyncs` tears down on `hidden` and re-subscribes on `visible`. If the user has multiple tabs, each tab independently subscribes. Should work, but two simultaneous channels mean duplicated events processed by `applyEvent` — the dedup-by-id in `applyEvent` (line 140) handles this correctly, but it depends on `event.id` being non-null on every event (which it is).

6. **`useStoreSyncs(null)` early in the render cycle.**
   `products-page-client.tsx` calls `useStoreSyncs(storeId)` BEFORE the `if (noStoreSelected) return ...` early exit. The hook handles `null` safely (returns empty arrays), but it depends on `useOrgSyncs()` returning a context value, which depends on `OrgSyncsProvider` being mounted above. Layout always mounts the provider — correct — but if the layout ever fails to render (e.g., the auth probe throws), `useStoreSyncs` throws "must be used inside OrgSyncsProvider".

---

## 6. Recommendations

In rank order, what I'd do before claiming victory:

1. **Add the end-to-end integration test (G1).** It's the single biggest gap, and writing it will likely surface 1–2 of the runtime issues. Should take ~1 hour.
2. **Add the Realtime tenant-isolation test (G3).** Security-critical and not currently exercised at the actual Realtime layer. ~30 min.
3. **Add the multi-worker concurrency test (G2).** ~15 min, uses `Promise.all` over `tryClaimNext`.
4. **Add `organizationId` to the Realtime wire shape (3.1).** Defense-in-depth, ~10 min.
5. **Add the `SyncCenter` FAILED_RETRYABLE component regression test (G7).** Prevents PR #68 from regressing. ~30 min.
6. **Add resume-from-cursor verification (G4) and retry-backoff math test (G6).** Together ~30 min.

Items 1–4 are the load-bearing ones. 5–6 are nice-to-have hardening.

---

## 7. Summary

| Area                                            | Verdict                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Schema + DB state                               | **Done** — exact match to plan                                                   |
| Code structure (files, services, hooks, routes) | **Done** — every file the plan called for exists, with code-quality improvements |
| Removed legacy code                             | **Done** — all 9 deletions verified                                              |
| OpenAPI + API changelog                         | **Done**                                                                         |
| Frontend hoist                                  | **Done** (after #66/#67/#68 patched 3 real regressions)                          |
| Tests required by spec §12                      | **Partial — 2 of 7 fully met, 4 partially, 1 missing**                           |
| End-to-end integration test                     | **Missing entirely**                                                             |
| Realtime wire shape `organization_id`           | **Missing — explicit plan deviation**                                            |
| Optimistic UX `setQueryData` on trigger         | **Missing — spec §9 deviation**                                                  |
| Bugs caught in practice (post-merge)            | **3 of them, all fixed in #66/#67/#68**                                          |

**Bottom line:** the architecture is structurally sound and code-complete to the plan's surface. The deferred tests left a class of integration regressions undetected at merge time, three of which surfaced in practice and were fixed reactively. **The likeliest sources of any new "errors in practice" the user is hitting are exactly the gaps in §4, especially G1 (no end-to-end test) and the optimistic-UX gap noted in §5 item 2.**
