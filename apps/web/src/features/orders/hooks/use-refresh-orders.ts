'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { orderKeys } from '../query-keys';

/**
 * Invalidates the orders list + KPI-summary caches. Does NOT call Trendyol —
 * the cron + webhook are the only paths that produce new rows in `orders`. It
 * simply re-reads whatever the worker has already written.
 *
 * Wired to PageSyncControl's `onFlowsSettled` (replacing the removed manual
 * "Yenile" button): the list and the KPI strip refresh the moment an orders (or
 * any orders-page source) sync completes. Realtime already drops individual
 * rows live; this reconciles the aggregate KPIs Realtime cannot recompute.
 */
export function useRefreshOrders(
  orgId: string | null,
  storeId: string | null,
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (orgId === null || storeId === null) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orderKeys.lists(orgId, storeId) }),
        queryClient.invalidateQueries({ queryKey: orderKeys.summaries(orgId, storeId) }),
      ]);
    },
  });
}
