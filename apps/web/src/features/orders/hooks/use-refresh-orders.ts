'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { orderKeys } from '../query-keys';

/**
 * Triggers a client-side refresh of the orders list cache. Does NOT
 * call Trendyol — the cron + webhook are the only paths that produce
 * new rows in `orders`. This button is purely a UX affordance for
 * "tabloyu tazele" without the seller hitting F5.
 *
 * Anti-spam: React Query's natural deduplication + invalidate
 * debounce is sufficient. No backend rate limit needed because no
 * vendor API is involved.
 *
 * Replaces PR-11d's useStartOrderSync (which POST'd to a
 * /orders/sync endpoint that has since been removed in PR-D
 * 2026-05-24).
 */
export function useRefreshOrders(
  orgId: string | null,
  storeId: string | null,
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (orgId === null || storeId === null) return;
      await queryClient.invalidateQueries({
        queryKey: orderKeys.lists(orgId, storeId),
      });
    },
  });
}
