# Sync Engine v2 — Completion Execution Plan

> **Companion to** [`2026-04-28-sync-engine-completion-handoff.md`](2026-04-28-sync-engine-completion-handoff.md). The handoff is the technical spec — exact code per task, file paths, test sketches. This doc is the **execution plan**: scope decisions, PR sequence, and the per-PR gates.
>
> Read the handoff first for technical detail. Read this doc to know which PR is next and what's in/out.

**Created:** 2026-04-28
**Status:** Approved — ready to execute

---

## §1. Live state on 2026-04-28

A diagnostic against local Supabase (`127.0.0.1:54322`) immediately before writing this plan:

- `sync_logs` table is **empty** — zero rows of any status. The bug the handoff §B describes (a Trendyol product sync stuck at `FAILED_RETRYABLE` with `attemptCount=2` for hours) is **not currently reproducible** in local DB.
- Real seed data is intact — 2 organizations, 2 stores, 5 products.
- Two orphan worker processes from 2:30 AM today (PIDs 50615, 50869) were polling against an empty queue. Slated for kill before any integration test run.
- Current `pnpm dev` worker session (PIDs 89603 / 89604 / 89616, started ~16:30) is healthy.

**Implication:** §B's *investigation* phase has nothing to investigate. Only the *prevention* half of §B (wire `apps/sync-worker` into `pnpm dev`) is real work.

## §2. Scope decisions

| Section in handoff | Decision | Rationale |
|---|---|---|
| §B (investigation) | **Skip** | DB has no stuck row. |
| §B (prevention — `pnpm dev` starts worker) | **Keep** | Eliminates "user forgot to start worker" foot-gun. |
| §C (observability) | **Keep — first** | Foundational; every later PR's debugging benefits. |
| §D.1 — Realtime wire `organization_id` | **Keep** | Defense-in-depth on tenant isolation. |
| §D.2 — Optimistic `setQueryData` on trigger | **Keep** | Removes click → badge flicker. Stacks on §D.1. |
| §D.3 — End-to-end integration test | **Keep** | Single most important missing test. |
| §D.4 — SyncCenter component test | **Keep** | Locks the §68 fix from regressing. |
| §E.1 — Multi-worker race (T2) | **Keep** | Required to claim "scale out by adding workers". |
| §E.2 — Realtime tenant isolation (T1) | **Keep** | Security-critical path, separate evaluator from REST RLS. |
| §E.3 — Cursor resumption after watchdog reap (T3) | **Keep** | Existing watchdog test doesn't cover the resume half. |
| §E.4 — Backoff math (T4) | **Keep** | Locks the schedule + 30-min ceiling. |
| §E.5 — Graceful shutdown integration (T7) | **Keep** | Unit-mocked test exists; real-DB version doesn't. |
| §E.6 (T5/T6) | **No-op** | Already shipped. |
| §F — Manual retry button | **Defer** | Stretch; revisit after §E lands and we see real retry patterns. |

## §3. PR sequence

Seven PRs, each on its own branch off `main`. Most are independent; **PR #3 stacks on PR #2** because the optimistic-row type needs the `organizationId` field added in #2.

```
main
 ├─ PR #1 feat/sync-observability         (B-prevention + C)
 ├─ PR #2 feat/sync-organization-id-wire  (D.1)
 │   └─ PR #3 feat/sync-optimistic-trigger (D.2 — stacks on #2)
 ├─ PR #4 test/sync-integration-coverage  (D.3 + E.1 + E.3)
 ├─ PR #5 test/sync-center-retrying       (D.4)
 ├─ PR #6 test/sync-backoff-and-rls       (E.4 + E.2)
 └─ PR #7 test/sync-graceful-shutdown     (E.5)
```

### PR #1 — `feat/sync-observability`

**Scope:** §B-prevention + §C
- Verify `turbo.json` and root `package.json` `dev` script start `apps/sync-worker` alongside `apps/web` and `apps/api`. If not, add it.
- Create `packages/sync-core/src/logger.ts` (tiny structured logger — JSON in production, pretty in dev; no deps).
- Re-export from `packages/sync-core/src/index.ts`.
- Instrument every state transition in `packages/sync-core/src/sync-log.service.ts`: `acquireSlot`, `tick`, `complete`, `fail`, `markRetryable`, `releaseToPending`.
- Instrument `apps/sync-worker/src/index.ts`: boot, claim acquired, run start/complete/error, idle (throttled to 30 s), shutdown requested, watchdog reaped.
- Instrument `apps/sync-worker/src/handlers/products.ts`: chunk start, chunk complete, content upsert errors.
- Instrument `apps/api/src/routes/product.routes.ts`: trigger enqueued.

**Acceptance:** Trigger a sync from the UI; tail worker stdout. Every state transition is one structured log line. A deliberate failure (revoke creds mid-sync) shows `chunk.start → content.upsert.failed → worker.run.error → sync.retryable` chain. After waiting past `nextAttemptAt`, `worker.claim.acquired` for the same row → `chunk.start` resumes from saved cursor.

### PR #2 — `feat/sync-organization-id-wire`

**Scope:** §D.1
- Add `organization_id` to `SyncLogsRowWire` and `organizationId` to `SyncLogRealtimeShape` in `apps/web/src/lib/supabase/realtime.ts`.
- Map `organization_id → organizationId` in `snakeToCamel`.
- Propagate `organizationId` through `applyEvent` in `apps/web/src/features/sync/providers/org-syncs-provider.tsx`.
- Add `organizationId` to `SyncLogResponseSchema` in `apps/api/src/validators/product.validator.ts`.
- Add to `toSyncLogResponse` mapper.
- Regenerate OpenAPI client (`pnpm api:sync`).
- Update `apps/web/tests/unit/features/sync/use-org-syncs.test.tsx` mocks to include `organizationId`; assert it survives in cache.

**Acceptance:** Test passes. `pnpm typecheck` clean. Generated client diff includes `organizationId` on `SyncLogResponse`.

### PR #3 — `feat/sync-optimistic-trigger` (stacks on #2)

**Scope:** §D.2
- Replace `useStartProductSync.onSuccess` body with `queryClient.setQueryData<SyncLog[]>(orgSyncKeys.list(orgId), ...)` adding the optimistic PENDING row, then `invalidateQueries` so the canonical row replaces it.
- Add unit test: fire `startProductSync` mock, assert cache contains the optimistic PENDING row before any Realtime event arrives.

**Acceptance:** Click "Senkronize Et" → SyncCenter immediately shows "Kuyrukta". Within ~1 s transitions to "Çalışıyor". No flicker between click and badge.

### PR #4 — `test/sync-integration-coverage`

**Scope:** §D.3 + §E.1 + §E.3 (three independent tests, one PR — they share the same `apps/sync-worker/tests/integration` setup and amortize CI startup)
- **§D.3** — Create `apps/sync-worker/tests/integration/end-to-end.test.ts`: insert PENDING → mock fetch with 2 Trendyol pages → `tryClaimNext` → `runSyncToCompletion` → assert COMPLETED + products upserted.
- **§E.1** — Extend `packages/sync-core/tests/integration/claim.test.ts` with two new cases: 2-worker race (exactly one wins), 5-worker × 5-row distribution (each worker claims a distinct row).
- **§E.3** — Extend `apps/sync-worker/tests/integration/watchdog.test.ts` with a cursor-preservation case: stale RUNNING with `pageCursor: { kind: 'page', n: 5 }` → watchdog reaps → `tryClaimNext` returns it with cursor + progress preserved, `attemptCount` incremented.

**Acceptance:** All three tests pass. Full integration suite green.

### PR #5 — `test/sync-center-retrying`

**Scope:** §D.4
- Create `apps/web/tests/component/sync-center.test.tsx`. Cover: FAILED_RETRYABLE renders in "Yeniden Deneniyor" section (not "Geçmiş"); errorCode + errorMessage visible; retry timing format ("Yeniden denenecek HH:MM"); attempt count "Deneme N"; "Ürünleri şimdi senkronize et" button **disabled** while a FAILED_RETRYABLE row exists for that syncType.

**Acceptance:** `pnpm --filter web test:component sync-center` passes.

### PR #6 — `test/sync-backoff-and-rls`

**Scope:** §E.4 + §E.2 (one small DB-level test + one Realtime test, both touch tenant invariants)
- **§E.4** — Create `packages/sync-core/tests/integration/sync-log.service.test.ts`. Use `it.each` for 7 attempt counts (1, 2, 3, 4, 5, 6, 10) — verify backoff is `30s × 2^(n-1)` capped at 30 min, plus `claimedAt`/`claimedBy` cleared.
- **§E.2** — Create `apps/api/tests/integration/rls/sync-logs-realtime.rls.test.ts`. Two cases: (1) user A's Realtime channel does NOT receive events from org B's syncs; (2) user A's channel DOES receive events from its own org. Use `createRlsScopedClient` pattern from existing RLS tests.

**Acceptance:** Both files pass; full RLS suite green.

### PR #7 — `test/sync-graceful-shutdown`

**Scope:** §E.5
- Create `apps/sync-worker/tests/integration/shutdown.test.ts`. Mock 3-page Trendyol response; pass `shuttingDown` callback that returns `false` on first call (page 1 runs), `true` thereafter. Assert: row goes back to PENDING, `claimedAt`/`claimedBy` cleared, `progressCurrent > 0`, `pageCursor` non-null.

**Acceptance:** Test passes.

## §4. Per-PR gates (project conventions, non-negotiable)

For every PR, before opening:

1. Run `/simplify` on changed code (CLAUDE.md "Pre-Commit Skill Workflow").
2. Run `/postgres` on changed DB code OR `/vercel-react-best-practices` on changed React/Next code.
3. `pnpm check:full` from repo root passes (typecheck + lint + ALL tests + format check, needs `supabase start`).
4. Conventional-commit message; co-author trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
5. **Ask user before `git commit`** — project memory rule, never auto-commit even in continuous mode.
6. Branch + PR (never commit to `main`).
7. No `--no-verify` flags, no skipped tests without a tracked TODO, no test pruning to make CI green.

## §5. Out of scope

- §F (manual retry button) — deferred.
- Anything not in the PR table above. If a fresh problem surfaces during execution (e.g., a bug spotted while instrumenting `sync-log.service.ts`), surface it to the user; do not unilaterally expand scope.

## §6. Open risks

- **Orphan workers from earlier today** (PIDs 50615, 50869) can race with integration-test fixtures by claiming rows the test expects to seed. Must be killed before PR #4–#7 work begins. The agent's `kill` was sandbox-blocked; user runs `kill -9 50615 50869` directly.
- **Realtime test (§E.2)** depends on `createRlsScopedClient` accepting a `userProfile` shape; if the helper's signature differs, adapt rather than reshape the helper.
- **Backoff math test (§E.4)** uses wall-clock comparisons with ±2 s tolerance. CI under load could flake; if so, widen to ±5 s and add a code comment explaining why.

## §7. References

- **Architecture spec:** `docs/plans/2026-04-27-sync-engine-architecture-design.md`
- **Original implementation plan:** `docs/plans/2026-04-27-sync-engine-architecture-implementation.md`
- **Audit:** `docs/audits/2026-04-28-sync-plan-audit.md`
- **Handoff (technical detail per task):** `docs/plans/2026-04-28-sync-engine-completion-handoff.md`
