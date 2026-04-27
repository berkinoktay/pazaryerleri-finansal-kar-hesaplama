// SyncLog lifecycle helpers used by every sync orchestration (Products
// today; Orders / Settlements when those land). Keep this service generic
// across SyncType — the per-resource service (e.g. ProductSyncService)
// is the one that knows what "a batch" means.

import { prisma } from '@pazarsync/db';
import type { SyncLog, SyncType } from '@pazarsync/db';

import { NotFoundError, SyncInProgressError } from './errors';

const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

export async function start(input: {
  organizationId: string;
  storeId: string;
  syncType: SyncType;
}): Promise<SyncLog> {
  return prisma.syncLog.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      syncType: input.syncType,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });
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

export async function complete(id: string, syncedCount: number): Promise<void> {
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
 * Mark any RUNNING SyncLog rows for `(storeId, syncType)` older than the
 * 10-minute threshold as FAILED with `errorCode: 'SYNC_TIMEOUT'`. Run on
 * every sync start so a previous crashed/orphaned run is reaped before
 * the new one acquires the advisory lock — otherwise the SyncCenter UI
 * would show a permanent "syncing…" state.
 *
 * Returns the number of rows reaped (useful for tests + ops logs).
 */
export async function cleanupStaleRunning(storeId: string, syncType: SyncType): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS);
  const { count } = await prisma.syncLog.updateMany({
    where: {
      storeId,
      syncType,
      status: 'RUNNING',
      startedAt: { lt: cutoff },
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorCode: 'SYNC_TIMEOUT',
      errorMessage: 'Sync did not complete within the timeout window',
    },
  });
  return count;
}

/**
 * Atomically acquire the sync "slot" for a `(storeId, syncType)`.
 *
 * The partial unique index `sync_logs_active_slot_uniq` (see
 * `supabase/sql/rls-policies.sql`) atomically guarantees one active sync
 * per slot at the database level: concurrent INSERTs of an active row
 * (PENDING / RUNNING / FAILED_RETRYABLE) for the same `(storeId, syncType)`
 * trigger Postgres `23505` (unique violation), which Prisma surfaces as
 * `P2002`. The flow:
 *
 *   1. Reap any stale RUNNING rows (>10 min) for this slot — frees the
 *      slot when the previous worker crashed without a terminal write.
 *   2. INSERT a fresh RUNNING row. If the partial index rejects it, we
 *      lost the race: throw `SyncInProgressError`.
 *   3. Defensive re-check (legacy): if for any reason two RUNNING rows
 *      coexist (e.g. a row pre-dating the unique index), the oldest wins
 *      and the loser marks itself FAILED with code `SYNC_IN_PROGRESS`.
 *
 * PR 4 of the sync-engine architecture migration replaces this entirely
 * with a PENDING-row enqueue + worker claim flow; the legacy re-check
 * fallback is unreachable in practice once the unique index is in place
 * but kept here until that migration lands.
 *
 * Returns the SyncLog row the caller will write progress to.
 */
export async function acquireSlot(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
): Promise<SyncLog> {
  await cleanupStaleRunning(storeId, syncType);

  let log: SyncLog;
  try {
    log = await start({ organizationId, storeId, syncType });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new SyncInProgressError({ syncType, storeId });
    }
    throw err;
  }

  const allRunning = await prisma.syncLog.findMany({
    where: { storeId, syncType, status: 'RUNNING' },
    orderBy: { startedAt: 'asc' },
    select: { id: true },
  });

  if (allRunning.length > 1 && allRunning[0]?.id !== log.id) {
    await fail(log.id, 'SYNC_IN_PROGRESS', 'Another sync acquired the slot first');
    throw new SyncInProgressError({ syncType, storeId });
  }

  return log;
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
