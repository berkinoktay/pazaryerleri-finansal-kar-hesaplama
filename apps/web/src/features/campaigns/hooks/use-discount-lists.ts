'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { keepPreviousWithinStore } from '@/lib/query-scope-placeholder';

import { listDiscountLists, type DiscountListListItem } from '../api/list-discount-lists.api';
import { discountListKeys } from '../query-keys';

/**
 * useQuery wrapper for the saved discount lists. Pass `storeId = null` to disable (no store
 * context). `placeholderData` keeps the previous rows on screen while a refetch (e.g. after
 * import/delete) is in flight, but drops them on a store switch.
 */
export function useDiscountLists(
  orgId: string,
  storeId: string | null,
): UseQueryResult<DiscountListListItem[]> {
  return useQuery<DiscountListListItem[]>({
    queryKey:
      storeId !== null
        ? discountListKeys.lists(orgId, storeId)
        : ([...discountListKeys.all, 'list', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null) throw new Error('useDiscountLists called with null storeId');
      return listDiscountLists(orgId, storeId);
    },
    enabled: storeId !== null,
    // Drop the previous rows on a store switch so another store's list never
    // flashes on this store's screen; keep them for in-store refetches.
    placeholderData: keepPreviousWithinStore<DiscountListListItem[]>(storeId ?? ''),
  });
}
