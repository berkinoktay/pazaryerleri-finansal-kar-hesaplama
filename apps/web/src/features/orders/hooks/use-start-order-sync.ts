'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { type SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { orgSyncKeys } from '@/features/sync/query-keys';

import { startOrderSync, type StartSyncResponse } from '../api/start-order-sync.api';

/**
 * Mutation that kicks off a Trendyol order sync. Mirrors useStartProductSync —
 * the only delta is syncType=ORDERS on the optimistic row. Returns the new
 * SyncLog id immediately; the sync-worker claims and runs the actual sync
 * in the background.
 *
 * Optimistic strategy: write a PENDING row directly into the org-wide
 * sync-logs cache so the SyncBadge + SyncCenter transition within the same
 * React commit as the click. Realtime delivers the canonical RUNNING row a
 * beat later; the subsequent invalidate reconciles in case Realtime missed
 * the INSERT. The OrgSyncsProvider (mounted at the dashboard layout) owns
 * the cache for orgSyncKeys.list(orgId), so every consumer of useStoreSyncs
 * / useOrgSyncs picks up the update.
 *
 * Errors fall through to the global onError pipeline. 409 SYNC_IN_PROGRESS
 * surfaces as the localized "Senkronizasyon zaten çalışıyor" toast via
 * common.errors.SYNC_IN_PROGRESS.
 */
export function useStartOrderSync(
  orgId: string | null,
  storeId: string | null,
): UseMutationResult<StartSyncResponse, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<StartSyncResponse, Error, void>({
    mutationFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useStartOrderSync called without orgId/storeId');
      }
      return startOrderSync(orgId, storeId);
    },
    onSuccess: (data) => {
      if (orgId === null || storeId === null) return;
      const queryKey = orgSyncKeys.list(orgId);
      queryClient.setQueryData<SyncLog[] | undefined>(queryKey, (existing) => {
        const optimistic: SyncLog = {
          id: data.syncLogId,
          organizationId: orgId,
          storeId,
          syncType: 'ORDERS',
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
          skippedPages: null,
        };
        const withoutDup = (existing ?? []).filter((s) => s.id !== data.syncLogId);
        return [optimistic, ...withoutDup];
      });
      // Reconcile with the canonical row once Realtime/REST surfaces it.
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
