// SyncLog lifecycle helpers used by every sync orchestration (Products
// today; Orders / Settlements when those land). Keep this service generic
// across SyncType — the per-resource service (e.g. ProductSyncService)
// is the one that knows what "a batch" means.

import { prisma } from '@pazarsync/db';
import type { Prisma, SyncLog, SyncTriggerSource, SyncType } from '@pazarsync/db';
import { SyncErrorCode } from '@pazarsync/db/enums';

import { parseSkippedPages, type ProductsCursor, type SkippedPageEntry } from './checkpoint';
import { LostLeaseError, NotFoundError, SyncInProgressError } from './errors';
import { syncLog } from './logger';

// ─── Lease fencing ────────────────────────────────────────────────────
//
// Every write issued by the worker that CURRENTLY HOLDS a claim goes
// through this fence instead of a bare `update({ where: { id } })`. The
// updateMany only matches while the row is still RUNNING AND claimed by
// this exact worker; a zero-row result means the watchdog reaper (or a
// peer that re-claimed after a stale sweep) has taken the row over, so we
// throw LostLeaseError and the worker abandons it WITHOUT clobbering the
// new owner's state. Read/API-side helpers (acquireSlot, advance,
// listActiveAndRecent, listOrgActiveAndRecent, getById) are intentionally
// NOT fenced — they are not claim-holder writes.

async function fencedUpdate(
  syncLogId: string,
  workerId: string,
  data: Prisma.SyncLogUpdateManyMutationInput,
): Promise<void> {
  const { count } = await prisma.syncLog.updateMany({
    where: { id: syncLogId, claimedBy: workerId, status: 'RUNNING' },
    data,
  });
  if (count === 0) {
    throw new LostLeaseError(syncLogId, workerId);
  }
}

export async function advance(
  id: string,
  progressCurrent: number,
  progressTotal: number | null,
  progressStage?: string,
): Promise<void> {
  await prisma.syncLog.update({
    where: { id },
    data: {
      progressCurrent,
      progressTotal,
      ...(progressStage !== undefined ? { progressStage } : {}),
    },
  });
}

export async function complete(id: string, syncedCount: number, workerId: string): Promise<void> {
  syncLog.info('sync.completed', { syncLogId: id, finalCount: syncedCount });
  await fencedUpdate(id, workerId, {
    status: 'COMPLETED',
    completedAt: new Date(),
    recordsProcessed: syncedCount,
    progressCurrent: syncedCount,
    // A run that recovered via markRetryable carries the last transient
    // error in these fields — a COMPLETED row must not advertise one.
    errorCode: null,
    errorMessage: null,
  });
}

export async function fail(
  id: string,
  errorCode: SyncErrorCode,
  errorMessage: string,
  workerId: string,
): Promise<void> {
  syncLog.error('sync.failed', { syncLogId: id, errorCode, errorMessage });
  await fencedUpdate(id, workerId, {
    status: 'FAILED',
    completedAt: new Date(),
    errorCode,
    errorMessage,
  });
}

/**
 * Acquire a sync slot for `(organizationId, storeId, syncType)` by
 * inserting a PENDING SyncLog row. The partial unique index
 * `sync_logs_active_slot_uniq` (see supabase/sql/rls-policies.sql)
 * atomically rejects a second active row for the same slot — Postgres
 * returns 23505 / Prisma `P2002`, which we map to `SyncInProgressError`
 * with the existing run's id in `meta.existingSyncLogId` so the UI can
 * navigate to the live progress.
 *
 * Returns the new PENDING SyncLog row. The worker (`apps/sync-worker`)
 * picks it up via `tryClaimNext` typically within ~1 s of insertion;
 * stale runs are recovered by the worker's stale-claim watchdog (90 s
 * heartbeat threshold) — there is no longer a need to reap from the
 * acquire path.
 *
 * `opts.startedAt` lets a caller enqueueing SEVERAL types pin a strict
 * FIFO order: `tryClaimNext` claims `ORDER BY COALESCE(next_attempt_at,
 * started_at)`, which for PENDING rows (null next_attempt_at) falls back to
 * started_at — so distinct per-type start stamps still preserve the bootstrap
 * FIFO intent, and rows created in the same millisecond would otherwise tie
 * non-deterministically.
 *
 * `triggerSource` records who initiated the run (default CRON so the
 * scheduled fan-out path stays unchanged); the API passes MANUAL for
 * user-triggered syncs and BOOTSTRAP for the store-connect chain. Only
 * MANUAL rows are consulted by the manual-trigger cooldown check.
 */
export async function acquireSlot(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
  triggerSource: SyncTriggerSource = 'CRON',
  opts?: { startedAt?: Date },
): Promise<SyncLog> {
  syncLog.info('slot.acquire.attempt', { organizationId, storeId, syncType, triggerSource });
  try {
    const created = await prisma.syncLog.create({
      data: {
        organizationId,
        storeId,
        syncType,
        status: 'PENDING',
        triggerSource,
        startedAt: opts?.startedAt ?? new Date(),
      },
    });
    syncLog.info('slot.acquired', {
      organizationId,
      storeId,
      syncType,
      syncLogId: created.id,
    });
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await prisma.syncLog.findFirst({
        where: {
          storeId,
          syncType,
          status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] },
        },
        select: { id: true },
      });
      syncLog.warn('slot.conflict', {
        organizationId,
        storeId,
        syncType,
        existingSyncLogId: existing?.id,
      });
      throw new SyncInProgressError({
        syncType,
        storeId,
        existingSyncLogId: existing?.id,
      });
    }
    throw err;
  }
}

/**
 * Narrow an unknown caught value to a Prisma P2002 unique-violation error.
 * Avoids importing the generated `Prisma` namespace here — duck-types on
 * the public shape Prisma documents. The `'code' in err` check narrows
 * `err` to `{ code: unknown }`, so no type assertion is needed.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}

/**
 * Hydrate the SyncCenter UI: every active (RUNNING) sync log + the most
 * recent N completed/failed runs for `(orgId, storeId)`. Sorted newest
 * first within each group; active rows always come first regardless of
 * timestamp so the live progress is at the top of the panel.
 *
 * Generic across SyncType — orders/settlements syncs reuse this when
 * those features land.
 */
export async function listActiveAndRecent(
  organizationId: string,
  storeId: string,
  recentLimit = 5,
): Promise<SyncLog[]> {
  const [active, recent] = await Promise.all([
    prisma.syncLog.findMany({
      where: {
        storeId,
        status: 'RUNNING',
        store: { organizationId },
      },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.syncLog.findMany({
      where: {
        storeId,
        status: { in: ['COMPLETED', 'FAILED'] },
        store: { organizationId },
      },
      orderBy: { startedAt: 'desc' },
      take: recentLimit,
    }),
  ]);
  return [...active, ...recent];
}

/**
 * Org-wide twin of `listActiveAndRecent`. Returns every active sync log
 * (PENDING / RUNNING / FAILED_RETRYABLE) across every store the
 * organization owns, plus the most recent N completed/failed runs (also
 * org-wide). Active rows come first, sorted newest first.
 *
 * Powers the dashboard-shell SyncBadge so any active sync surfaces to
 * every authenticated org member regardless of which page they're on.
 *
 * Set `opts.activeOnly = true` to skip the recent-finished query when
 * the caller only cares about live work — the SyncBadge polls in active-
 * only mode to keep the response tiny.
 */
export async function listOrgActiveAndRecent(
  organizationId: string,
  opts: { activeOnly: boolean; recentLimit?: number; storeIds?: string[] } = { activeOnly: false },
): Promise<SyncLog[]> {
  const recentLimit = opts.recentLimit ?? 5;
  // store-access narrowing: callers pass the store ids the user may see
  // (OWNER/ADMIN omit it for all stores; MEMBER/VIEWER pass their granted set,
  // possibly empty → no rows). Mirrors can_access_store at the service layer.
  const storeFilter = opts.storeIds === undefined ? {} : { storeId: { in: opts.storeIds } };
  const [active, recent] = await Promise.all([
    prisma.syncLog.findMany({
      where: {
        organizationId,
        ...storeFilter,
        status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] },
      },
      orderBy: { startedAt: 'desc' },
    }),
    opts.activeOnly
      ? Promise.resolve<SyncLog[]>([])
      : prisma.syncLog.findMany({
          where: { organizationId, ...storeFilter, status: { in: ['COMPLETED', 'FAILED'] } },
          orderBy: { startedAt: 'desc' },
          take: recentLimit,
        }),
  ]);
  return [...active, ...recent];
}

/**
 * Read a single SyncLog row scoped to (org, store). Returns 404 (non-
 * disclosure) on cross-tenant or missing rows. Used by the polling
 * endpoint and SyncCenter hydration query.
 */
export async function getById(
  organizationId: string,
  storeId: string,
  syncLogId: string,
): Promise<SyncLog> {
  const row = await prisma.syncLog.findFirst({
    where: {
      id: syncLogId,
      storeId,
      store: { organizationId },
    },
  });
  if (row === null) {
    throw new NotFoundError('SyncLog', syncLogId);
  }
  return row;
}

/**
 * The most recent MANUAL-triggered sync for `(organizationId, storeId,
 * syncType)` — any status, newest first — or null when the user has
 * never manually triggered this sync type on this store.
 *
 * Powers the manual-trigger cooldown check in the API
 * (apps/api/src/services/sync-trigger.service.ts). Scheduled (CRON) and
 * store-connect (BOOTSTRAP) rows are excluded on purpose so an automated
 * fan-out never counts against a user's manual refresh window. The API
 * owns the window comparison and the 429; this helper only reads the row.
 */
export async function getMostRecentManualSync(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
): Promise<SyncLog | null> {
  return prisma.syncLog.findFirst({
    where: { organizationId, storeId, syncType, triggerSource: 'MANUAL' },
    orderBy: { startedAt: 'desc' },
  });
}

// ─── Worker chunk-loop helpers (PR 4) ─────────────────────────────────
//
// These are called by `apps/sync-worker` between chunks of a claimed
// SyncLog. They live here (not in the worker app) so the API can also
// surface their semantics in tests / future replay tooling without a
// reverse dependency on sync-worker.

export interface TickInput {
  cursor: unknown;
  progress: number;
  total: number | null;
  stage: string;
}

/**
 * Persist progress between chunks. Stamps `lastTickAt` so the stale-
 * claim reaper (PR 4f) can tell a live worker from a crashed one, and
 * stores the cursor / progress / stage so the SyncCenter UI sees motion
 * and a redeploy mid-sync resumes from the right place.
 */
export async function tick(syncLogId: string, input: TickInput, workerId: string): Promise<void> {
  syncLog.info('chunk.tick', {
    syncLogId,
    progress: input.progress,
    total: input.total,
    stage: input.stage,
    cursor: input.cursor,
  });
  await fencedUpdate(syncLogId, workerId, {
    lastTickAt: new Date(),
    pageCursor: input.cursor as never,
    progressCurrent: input.progress,
    progressTotal: input.total,
    progressStage: input.stage,
  });
}

/**
 * Heartbeat for single-chunk handlers (CLAIMS, SETTLEMENTS): stamps
 * `lastTickAt` WITHOUT touching cursor/progress so the 90s stale-claim
 * watchdog can tell a long full-window scan from a crashed worker.
 * Chunked handlers get this for free via tick(); cursorless scans must
 * call it periodically mid-loop or a >90s scan gets reaped and re-run
 * concurrently by a peer.
 */
export async function heartbeat(syncLogId: string, workerId: string): Promise<void> {
  await fencedUpdate(syncLogId, workerId, { lastTickAt: new Date() });
}

/**
 * Hand a claimed row back to PENDING so another worker can pick it up.
 * Used by the graceful-shutdown path: the worker is going down, the
 * cursor is already persisted from the last tick, so dropping the
 * claim (claimedAt/claimedBy → null) is enough — `pageCursor` is
 * intentionally NOT cleared so the next claimer resumes mid-run.
 *
 * `attemptCount` is reset to 0 as well. This release is reachable ONLY after
 * a chunk completed cleanly (no thrown error — the loop checks shuttingDown
 * BETWEEN chunks), so it can never mask a poison job. Resetting the budget
 * prevents a redeploy storm from burning a healthy long-running sync toward
 * terminal FAILED: each graceful hand-off would otherwise leave the claim
 * increment in place, and a few rolling restarts could exhaust MAX_ATTEMPTS
 * on a sync that was making steady progress. A genuinely stuck run is still
 * caught by the watchdog reaper + the per-attempt cap on the error path.
 */
export async function releaseToPending(syncLogId: string, workerId: string): Promise<void> {
  syncLog.info('sync.released', { syncLogId });
  await fencedUpdate(syncLogId, workerId, {
    status: 'PENDING',
    claimedAt: null,
    claimedBy: null,
    attemptCount: 0,
  });
}

/**
 * Mark a chunk failure as retryable with exponential backoff.
 *
 * Backoff schedule: 30s × 2^(attemptCount-1), capped at 30 min.
 *   attempt 1 →  30s
 *   attempt 2 →  60s
 *   attempt 3 →  2 min
 *   attempt 4 →  4 min
 *   attempt 5 →  8 min
 *   attempt 6 → 16 min
 *   attempt 7+ → 30 min (cap)
 *
 * The claim helper (`tryClaimNext`) skips FAILED_RETRYABLE rows whose
 * `nextAttemptAt` is in the future, so the row stays untouched until
 * the backoff elapses.
 */
export async function markRetryable(
  syncLogId: string,
  attemptCount: number,
  errorCode: SyncErrorCode,
  errorMessage: string,
  workerId: string,
): Promise<void> {
  const backoffMs = Math.min(30_000 * Math.pow(2, attemptCount - 1), 30 * 60_000);
  const nextAttemptAt = new Date(Date.now() + backoffMs);
  syncLog.warn('sync.retryable', {
    syncLogId,
    attemptCount,
    errorCode,
    nextAttemptAt: nextAttemptAt.toISOString(),
  });
  await fencedUpdate(syncLogId, workerId, {
    status: 'FAILED_RETRYABLE',
    errorCode,
    errorMessage,
    nextAttemptAt,
    claimedAt: null,
    claimedBy: null,
  });
}

/**
 * Skip the currently-stuck page and continue the sync from the next
 * page. Used when MAX_ATTEMPTS is exhausted on a transient marketplace
 * error (deterministic upstream 5xx on a specific page) — terminating
 * the whole sync for one bad sayfa was leaving merchants with half-
 * synced catalogs.
 *
 * Atomically:
 *   - Re-reads the current `skippedPages` array (Prisma JSON columns
 *     are not safe to splice via raw SQL with optimistic locking; the
 *     transaction also serializes against any concurrent worker).
 *   - Appends the new entry.
 *   - Resets attemptCount to 0 so the next claim starts fresh.
 *   - Advances the cursor (NOT progressCurrent) to the next page.
 *   - Returns the row to PENDING with claimedAt/claimedBy/error fields
 *     cleared, so the worker's poll-and-claim loop picks it up
 *     immediately (next tick).
 *
 * Why progressCurrent is NOT bumped: the products handler computes the
 * next progress as `log.progressCurrent + batch.length`. If we bumped
 * progressCurrent here by an estimated 100 (the page size), the next
 * chunk's progress would double-count — and `complete(finalCount)` at
 * the end of the run would write a recordsProcessed that doesn't match
 * the real number of upserts (real = count seen by Trendyol minus the
 * skipped page). The visual cost is one chunk's worth of "no progress
 * bar movement" right after the skip — strictly correct numbers beat
 * smooth-looking-but-lying ones.
 */
export async function recordSkippedPageAndContinue(
  syncLogId: string,
  skipEntry: SkippedPageEntry,
  nextCursor: ProductsCursor | null,
  workerId: string,
): Promise<void> {
  syncLog.warn('sync.page-skipped', {
    syncLogId,
    page: skipEntry.page,
    errorCode: skipEntry.errorCode,
    httpStatus: skipEntry.httpStatus,
    xRequestId: skipEntry.xRequestId,
  });
  await prisma.$transaction(async (tx) => {
    const current = await tx.syncLog.findUniqueOrThrow({
      where: { id: syncLogId },
      select: { skippedPages: true },
    });
    const existing = parseSkippedPages(current.skippedPages);
    // Lease-fenced inside the transaction: the worker still holds the
    // RUNNING claim when handleRunError drives the skip recovery, so a
    // zero-row result means a reaper/peer took the row — abandon it.
    const { count } = await tx.syncLog.updateMany({
      where: { id: syncLogId, claimedBy: workerId, status: 'RUNNING' },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        pageCursor: nextCursor as never,
        skippedPages: [...existing, skipEntry] as never,
        claimedAt: null,
        claimedBy: null,
        errorCode: null,
        errorMessage: null,
        nextAttemptAt: null,
      },
    });
    if (count === 0) {
      throw new LostLeaseError(syncLogId, workerId);
    }
  });
}
