'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { startProductSync, type StartSyncResponse } from '../api/start-product-sync.api';
import { productKeys } from '../query-keys';

/**
 * Mutation that kicks off a Trendyol product sync. Returns the new
 * SyncLog id immediately (the BFF spawns the actual sync as a
 * background task).
 *
 * On success, invalidates the active-sync-logs query so the new
 * RUNNING row appears even if the Realtime channel hasn't carried
 * the INSERT event yet — Realtime is fast but not synchronous, and
 * the UI should never look "stuck" right after the user clicked.
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
    onSuccess: () => {
      if (orgId === null || storeId === null) return;
      void queryClient.invalidateQueries({
        queryKey: productKeys.syncLogs(orgId, storeId),
      });
    },
  });
}
