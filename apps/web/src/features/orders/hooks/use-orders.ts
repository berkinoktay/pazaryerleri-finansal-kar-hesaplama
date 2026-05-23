'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listOrders, type ListOrdersArgs, type ListOrdersResponse } from '../api/list-orders.api';
import { orderKeys, type OrderListFilters } from '../query-keys';

/**
 * Lists orders for a store. Disabled when args is null (no active org/store
 * resolved yet) — avoids a wasted fetch + reads cleanly during cold load.
 */
export function useOrders(args: ListOrdersArgs | null): UseQueryResult<ListOrdersResponse> {
  return useQuery<ListOrdersResponse>({
    queryKey:
      args !== null
        ? orderKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : ['orders', 'list', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useOrders called with null args');
      return listOrders(args);
    },
    enabled: args !== null,
  });
}

function argsToFilters(args: ListOrdersArgs): OrderListFilters {
  return {
    status: args.status ?? '',
    reconciliationStatus: args.reconciliationStatus ?? '',
    from: args.from ?? '',
    to: args.to ?? '',
    q: args.q ?? '',
    page: args.page,
    perPage: args.perPage,
  };
}
