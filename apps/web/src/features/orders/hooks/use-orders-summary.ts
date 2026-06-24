'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getOrdersSummary,
  type OrderSummary,
  type OrdersSummaryArgs,
} from '../api/get-orders-summary.api';
import { orderKeys } from '../query-keys';

/**
 * Filter-aware KPI summary for the orders page. Disabled when args is null
 * (no active org/store resolved yet). Keyed by the same filter shape as the
 * list so the two refetch in lockstep when a filter changes.
 */
export function useOrdersSummary(args: OrdersSummaryArgs | null): UseQueryResult<OrderSummary> {
  return useQuery<OrderSummary>({
    queryKey:
      args !== null
        ? orderKeys.summary(args.orgId, args.storeId, {
            status: args.status ?? '',
            reconciliationStatus: args.reconciliationStatus ?? '',
            costStatus: args.costStatus ?? '',
            lossOnly: args.lossOnly ?? false,
            from: args.from ?? '',
            to: args.to ?? '',
            q: args.q ?? '',
          })
        : ['orders', 'summary', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useOrdersSummary called with null args');
      return getOrdersSummary(args);
    },
    enabled: args !== null,
  });
}
