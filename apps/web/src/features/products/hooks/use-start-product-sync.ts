'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { type SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { orgSyncKeys } from '@/features/sync/query-keys';

import { startProductSync, type StartSyncResponse } from '../api/start-product-sync.api';

/**
 * Mutation that kicks off a Trendyol product sync. Returns the new
 * SyncLog id immediately (the BFF spawns the actual sync as a
 * background task).
 *
 * On success, writes an optimistic PENDING row directly into the
 * org-wide sync-logs cache so the SyncBadge and SyncCenter transition
 * within the same React commit as the click — no flicker between
 * "user clicked" and "active sync visible". Realtime delivers the
 * canonical RUNNING row a beat later (typically <1 s); the
 * subsequent invalidateQueries reconciles in case Realtime missed
 * the INSERT for any reason.
 *
 * The OrgSyncsProvider (mounted in the dashboard layout) owns the
 * cache for `orgSyncKeys.list(orgId)`, so writing/invalidating it
 * propagates to every consumer of `useStoreSyncs` / `useOrgSyncs`.
 *
 * Errors fall through to the global onError pipeline (translates
 * the code → toast). 409 SYNC_IN_PROGRESS surfaces as "Senkronizasyon
 * zaten çalışıyor" via `common.errors.SYNC_IN_PROGRESS` (added in
 * this PR's i18n keys).
 */
export function useStartProductSync(
  orgId: string | null,
  storeId: string | null,
): UseMutationResult<StartSyncResponse, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<StartSyncResponse, Error, void>({
    mutationFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useStartProductSync called without orgId/storeId');
      }
      return startProductSync(orgId, storeId);
    },
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
        const withoutDup = (existing ?? []).filter((s) => s.id !== data.syncLogId);
        return [optimistic, ...withoutDup];
      });
      // Reconcile with the canonical row once Realtime/REST surfaces it.
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
