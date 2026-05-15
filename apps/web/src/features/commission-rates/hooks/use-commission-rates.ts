'use client';

import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';

import {
  listCommissionRates,
  type ListCommissionRatesArgs,
  type ListCommissionRatesResponse,
} from '../api/list-commission-rates.api';
import { commissionRateKeys, type CommissionRateListFilters } from '../query-keys';

// Backend default; declared here so the queryFn can pass it explicitly
// (avoids a drift if backend defaults change later).
export const COMMISSION_RATES_PAGE_LIMIT = 50;

export type CommissionRatesInfiniteData = InfiniteData<
  ListCommissionRatesResponse,
  string | undefined
>;

/**
 * useInfiniteQuery wrapper for the commission-rates list. The cursor
 * lives in pageParam (NOT in the queryKey) so any filter change creates
 * a fresh queryKey and resets to page 1 automatically.
 *
 * Pass `null` to disable the query (no store / no org context).
 */
export function useCommissionRates(
  args: ListCommissionRatesArgs | null,
): UseInfiniteQueryResult<CommissionRatesInfiniteData, Error> {
  return useInfiniteQuery<
    ListCommissionRatesResponse,
    Error,
    CommissionRatesInfiniteData,
    ReturnType<typeof commissionRateKeys.list> | readonly string[],
    string | undefined
  >({
    queryKey:
      args !== null
        ? commissionRateKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : (['commission-rates', 'list', '__disabled__'] as const),
    queryFn: ({ pageParam }) => {
      if (args === null) throw new Error('useCommissionRates called with null args');
      return listCommissionRates({
        ...args,
        cursor: pageParam,
        limit: args.limit ?? COMMISSION_RATES_PAGE_LIMIT,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled: args !== null,
  });
}

function argsToFilters(args: ListCommissionRatesArgs): CommissionRateListFilters {
  return {
    ruleKind: args.ruleKind,
    productScope: args.productScope,
    q: args.q,
    sort: args.sort,
  };
}
