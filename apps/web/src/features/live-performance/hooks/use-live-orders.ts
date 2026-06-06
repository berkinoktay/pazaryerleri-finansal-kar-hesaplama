'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getLiveOrders, type LivePerformanceOrders } from '../api/get-live-orders.api';
import { LIVE_QUERY_STALE_MS, liveKeys, type LiveOrdersFilter } from '../query-keys';

/**
 * Today's orders feed (orders + buffer union), filtered by the active tab.
 * `counts` always reports every tab's total, so the tab labels stay accurate
 * regardless of the selected filter. Disabled until org + store resolve.
 */
export function useLiveOrders(
  orgId: string | null,
  storeId: string | null,
  filter: LiveOrdersFilter,
): UseQueryResult<LivePerformanceOrders> {
  const enabled = orgId !== null && storeId !== null;
  return useQuery<LivePerformanceOrders>({
    queryKey: enabled
      ? liveKeys.orders(orgId, storeId, filter)
      : [...liveKeys.all, 'orders', '__disabled__', filter],
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useLiveOrders called without org/store');
      }
      return getLiveOrders({ orgId, storeId, filter });
    },
    enabled,
    staleTime: LIVE_QUERY_STALE_MS,
  });
}
