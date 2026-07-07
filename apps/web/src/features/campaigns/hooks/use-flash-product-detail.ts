'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getFlashProductDetail,
  type FlashProductDetail,
} from '../api/get-flash-product-detail.api';
import { flashProductKeys } from '../query-keys';

/**
 * useQuery wrapper for one Flash Products list's detail (offer rows + per-scenario profit).
 * Disabled until both `storeId` and `listId` are known (no store / no route param).
 */
export function useFlashProductDetail(
  orgId: string,
  storeId: string | null,
  listId: string | null,
): UseQueryResult<FlashProductDetail> {
  const enabled = storeId !== null && listId !== null;
  return useQuery<FlashProductDetail>({
    queryKey: enabled
      ? flashProductKeys.detail(orgId, storeId, listId)
      : ([...flashProductKeys.all, 'detail', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null || listId === null) {
        throw new Error('useFlashProductDetail called with null args');
      }
      return getFlashProductDetail(orgId, storeId, listId);
    },
    enabled,
  });
}
