import type { SyncCenterLog } from '@/components/patterns/sync-center';

import type { SyncLog } from '../api/list-org-sync-logs.api';

/**
 * Flatten the provider's active + recent sync-log buckets into the
 * SyncCenterLog[] shape the SyncCenter sheet consumes. The projection is a
 * plain field passthrough — the pattern owns the sectioning (active / retrying /
 * recent) internally.
 */
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
