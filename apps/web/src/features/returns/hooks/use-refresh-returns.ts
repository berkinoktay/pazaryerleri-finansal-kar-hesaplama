'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { returnKeys } from '../query-keys';

/**
 * Client-side refresh of the returns page caches (list + KPI summary).
 * Does NOT call Trendyol — the 6h CLAIMS cron is the only path that
 * produces new claim rows; this surfaces whatever the worker has already
 * written. Wired to PageSyncControl's `onFlowsSettled` (replacing the removed
 * manual "Yenile" button). Mirrors useRefreshOrders.
 */
export function useRefreshReturns(
  orgId: string | null,
  storeId: string | null,
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (orgId === null || storeId === null) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: returnKeys.lists(orgId, storeId) }),
        queryClient.invalidateQueries({ queryKey: returnKeys.summaries(orgId, storeId) }),
      ]);
    },
  });
}
