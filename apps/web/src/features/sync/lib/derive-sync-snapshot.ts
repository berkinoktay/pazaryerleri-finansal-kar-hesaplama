import type { SyncState } from '@/components/patterns/sync-badge';
import type { SyncCenterLog } from '@/components/patterns/sync-center';

import type { SyncLog } from '../api/list-org-sync-logs.api';

export interface SyncSnapshot {
  state: SyncState;
  lastSyncedAt: Date | string | null;
  progress?: { current: number; total: number | null };
}

/**
 * Project one sync-type's log slice into a SyncBadge-friendly snapshot.
 * The provider already splits rows into active (PENDING/RUNNING/
 * FAILED_RETRYABLE) vs recent (COMPLETED/FAILED) buckets, so this is a thin
 * "first matching log per bucket wins" projection.
 *
 * Shared home (third consumer triggered the promotion — orders and products
 * still carry their own file-local copies; migrate them here on next touch).
 */
export function deriveSyncSnapshot(
  syncType: SyncLog['syncType'],
  activeSyncs: SyncLog[],
  recentSyncs: SyncLog[],
): SyncSnapshot {
  const active = activeSyncs.find((l) => l.syncType === syncType);
  if (active !== undefined) {
    return {
      state: active.status === 'FAILED_RETRYABLE' ? 'retrying' : 'syncing',
      lastSyncedAt: active.startedAt,
      progress: { current: active.progressCurrent, total: active.progressTotal },
    };
  }
  const recent = recentSyncs.find((l) => l.syncType === syncType);
  if (recent === undefined) {
    return { state: 'fresh', lastSyncedAt: null };
  }
  if (recent.status === 'FAILED') {
    return { state: 'failed', lastSyncedAt: recent.completedAt ?? recent.startedAt };
  }
  return { state: 'fresh', lastSyncedAt: recent.completedAt ?? recent.startedAt };
}

export function toSyncCenterLogs(activeSyncs: SyncLog[], recentSyncs: SyncLog[]): SyncCenterLog[] {
  return [...activeSyncs, ...recentSyncs].map(projectSyncLog);
}

function projectSyncLog(log: SyncLog): SyncCenterLog {
  return {
    id: log.id,
    storeId: log.storeId,
    syncType: log.syncType,
    status: log.status,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    recordsProcessed: log.recordsProcessed,
    progressCurrent: log.progressCurrent,
    progressTotal: log.progressTotal,
    errorCode: log.errorCode,
    errorMessage: log.errorMessage,
    attemptCount: log.attemptCount,
    nextAttemptAt: log.nextAttemptAt,
    skippedPages: log.skippedPages,
  };
}
