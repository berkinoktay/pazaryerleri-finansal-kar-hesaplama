'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listFlashProducts, type FlashProductListItem } from '../api/list-flash-products.api';
import { flashProductKeys } from '../query-keys';

/**
 * useQuery wrapper for the saved Flash Products list. Pass `storeId = null` to disable
 * (no store context). `placeholderData` keeps the previous rows on screen while a refetch
 * (e.g. after import/delete) is in flight.
 */
export function useFlashProductList(
  orgId: string,
  storeId: string | null,
): UseQueryResult<FlashProductListItem[]> {
  return useQuery<FlashProductListItem[]>({
    queryKey:
      storeId !== null
        ? flashProductKeys.lists(orgId, storeId)
        : ([...flashProductKeys.all, 'list', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null) throw new Error('useFlashProductList called with null storeId');
      return listFlashProducts(orgId, storeId);
    },
    enabled: storeId !== null,
    placeholderData: (previous) => previous,
  });
}
