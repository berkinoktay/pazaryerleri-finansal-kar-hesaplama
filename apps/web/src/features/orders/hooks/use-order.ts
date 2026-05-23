'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getOrder, type GetOrderArgs, type OrderDetail } from '../api/get-order.api';
import { orderKeys } from '../query-keys';

/**
 * Loads a single order's full graph (items, fees, claims). Disabled until
 * orgId + storeId + orderId are all resolved.
 */
export function useOrder(args: GetOrderArgs | null): UseQueryResult<OrderDetail> {
  return useQuery<OrderDetail>({
    queryKey:
      args !== null
        ? orderKeys.detail(args.orgId, args.storeId, args.orderId)
        : ['orders', 'detail', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useOrder called with null args');
      return getOrder(args);
    },
    enabled: args !== null,
  });
}
