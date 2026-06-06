'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getLiveTodayProducts,
  type LivePerformanceTodayProducts,
} from '../api/get-live-today-products.api';
import { LIVE_QUERY_STALE_MS, liveKeys } from '../query-keys';

/** Today's products (orders ∪ buffer). Disabled until org + store resolve. */
export function useLiveTodayProducts(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<LivePerformanceTodayProducts> {
  const enabled = orgId !== null && storeId !== null;
  return useQuery<LivePerformanceTodayProducts>({
    queryKey: enabled
      ? liveKeys.todayProducts(orgId, storeId)
      : [...liveKeys.all, 'today-products', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useLiveTodayProducts called without org/store');
      }
      return getLiveTodayProducts({ orgId, storeId });
    },
    enabled,
    staleTime: LIVE_QUERY_STALE_MS,
  });
}
