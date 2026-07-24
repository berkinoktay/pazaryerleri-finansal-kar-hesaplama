'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getDiscountListDetail,
  type DiscountListDetail,
} from '../api/get-discount-list-detail.api';
import { discountListKeys } from '../query-keys';

/**
 * useQuery wrapper for one discount list's detail (items + per-scenario profit). Disabled
 * until both `storeId` and `listId` are known (no store / no route param).
 */
export function useDiscountListDetail(
  orgId: string,
  storeId: string | null,
  listId: string | null,
): UseQueryResult<DiscountListDetail> {
  const enabled = storeId !== null && listId !== null;
  return useQuery<DiscountListDetail>({
    queryKey: enabled
      ? discountListKeys.detail(orgId, storeId, listId)
      : ([...discountListKeys.all, 'detail', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null || listId === null) {
        throw new Error('useDiscountListDetail called with null args');
      }
      return getDiscountListDetail(orgId, storeId, listId);
    },
    enabled,
  });
}
