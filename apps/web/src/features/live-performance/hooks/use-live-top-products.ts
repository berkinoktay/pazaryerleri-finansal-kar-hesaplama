'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getLiveTopProducts,
  type LivePerformanceTopProducts,
} from '../api/get-live-top-products.api';
import { LIVE_QUERY_STALE_MS, liveKeys } from '../query-keys';

/** Today's top 3 selling variants. Disabled until org + store resolve. */
export function useLiveTopProducts(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<LivePerformanceTopProducts> {
  const enabled = orgId !== null && storeId !== null;
  return useQuery<LivePerformanceTopProducts>({
    queryKey: enabled
      ? liveKeys.topProducts(orgId, storeId)
      : [...liveKeys.all, 'top-products', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useLiveTopProducts called without org/store');
      }
      return getLiveTopProducts({ orgId, storeId });
    },
    enabled,
    staleTime: LIVE_QUERY_STALE_MS,
  });
}
