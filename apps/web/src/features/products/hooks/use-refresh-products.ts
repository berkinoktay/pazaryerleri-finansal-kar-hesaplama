'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { productKeys } from '../query-keys';

/**
 * Invalidates the products list + facet caches. Does NOT call Trendyol — the
 * PRODUCTS full scan + hourly PRODUCTS_DELTA are the only paths that write
 * product rows; this re-reads whatever the worker has already written.
 *
 * Wired to PageSyncControl's `onFlowsSettled` so the table + the summary/tab
 * counts refresh the moment a products-page source sync completes (there was no
 * manual "Yenile" button on this page — this is purely the auto-refresh path).
 */
export function useRefreshProducts(
  orgId: string | null,
  storeId: string | null,
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (orgId === null || storeId === null) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productKeys.lists(orgId, storeId) }),
        queryClient.invalidateQueries({ queryKey: productKeys.facets(orgId, storeId) }),
      ]);
    },
  });
}
