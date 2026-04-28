// SyncLog lifecycle helpers used by every sync orchestration (Products
// today; Orders / Settlements when those land). Keep this service generic
// across SyncType — the per-resource service (e.g. ProductSyncService)
// is the one that knows what "a batch" means.

import { prisma } from '@pazarsync/db';
import type { SyncLog, SyncType } from '@pazarsync/db';

import { NotFoundError, SyncInProgressError } from './errors';
import { syncLog } from './logger';

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

export async function complete(id: string, syncedCount: number): Promise<void> {
  syncLog.info('sync.completed', { syncLogId: id, finalCount: syncedCount });
  await prisma.syncLog.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      recordsProcessed: syncedCount,
      progressCurrent: syncedCount,
    },
  });
}

export async function fail(id: string, errorCode: string, errorMessage: string): Promise<void> {
  syncLog.error('sync.failed', { syncLogId: id, errorCode, errorMessage });
  await prisma.syncLog.update({
    where: { id },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorCode,
      errorMessage,
    },
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
 */
export async function acquireSlot(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
): Promise<SyncLog> {
  syncLog.info('slot.acquire.attempt', { organizationId, storeId, syncType });
  try {
    const created = await prisma.syncLog.create({
      data: {
        organizationId,
        storeId,
        syncType,
        status: 'PENDING',
        startedAt: new Date(),
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
  opts: { activeOnly: boolean; recentLimit?: number } = { activeOnly: false },
): Promise<SyncLog[]> {
  const recentLimit = opts.recentLimit ?? 5;
  const [active, recent] = await Promise.all([
    prisma.syncLog.findMany({
      where: { organizationId, status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] } },
      orderBy: { startedAt: 'desc' },
    }),
    opts.activeOnly
      ? Promise.resolve<SyncLog[]>([])
      : prisma.syncLog.findMany({
          where: { organizationId, status: { in: ['COMPLETED', 'FAILED'] } },
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
export async function tick(syncLogId: string, input: TickInput): Promise<void> {
  syncLog.info('chunk.tick', {
    syncLogId,
    progress: input.progress,
    total: input.total,
    stage: input.stage,
    cursor: input.cursor,
  });
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      lastTickAt: new Date(),
      pageCursor: input.cursor as never,
      progressCurrent: input.progress,
      progressTotal: input.total,
      progressStage: input.stage,
    },
  });
}

/**
 * Hand a claimed row back to PENDING so another worker can pick it up.
 * Used by the graceful-shutdown path: the worker is going down, the
 * cursor is already persisted from the last tick, so dropping the
 * claim (claimedAt/claimedBy → null) is enough — `pageCursor` is
 * intentionally NOT cleared so the next claimer resumes mid-run.
 */
export async function releaseToPending(syncLogId: string): Promise<void> {
  syncLog.info('sync.released', { syncLogId });
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimedBy: null,
    },
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
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const backoffMs = Math.min(30_000 * Math.pow(2, attemptCount - 1), 30 * 60_000);
  const nextAttemptAt = new Date(Date.now() + backoffMs);
  syncLog.warn('sync.retryable', {
    syncLogId,
    attemptCount,
    errorCode,
    nextAttemptAt: nextAttemptAt.toISOString(),
  });
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
