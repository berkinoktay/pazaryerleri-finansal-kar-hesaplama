'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { keepPreviousWithinStore } from '@/lib/query-scope-placeholder';

import {
  listCommissionRates,
  type ListCommissionRatesArgs,
  type ListCommissionRatesResponse,
} from '../api/list-commission-rates.api';
import { commissionRateKeys, type CommissionRateListFilters } from '../query-keys';

/**
 * useQuery wrapper for the commission-rates list. `page` + `perPage` are
 * part of the queryKey so changing them re-fires the query (TanStack
 * Query keeps each page in its cache slot independently — cheap when the
 * user pages back and forth).
 *
 * Pass `null` to disable (no store / no org context).
 */
export function useCommissionRates(
  args: ListCommissionRatesArgs | null,
): UseQueryResult<ListCommissionRatesResponse> {
  return useQuery<ListCommissionRatesResponse>({
    queryKey:
      args !== null
        ? commissionRateKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : (['commission-rates', 'list', '__disabled__'] as const),
    queryFn: () => {
      if (args === null) throw new Error('useCommissionRates called with null args');
      return listCommissionRates(args);
    },
    enabled: args !== null,
    // Smooth in-store pagination, but drop the previous page on a store switch
    // so another store's rows never flash on this store's screen.
    placeholderData: keepPreviousWithinStore<ListCommissionRatesResponse>(args?.storeId ?? ''),
  });
}

function argsToFilters(args: ListCommissionRatesArgs): CommissionRateListFilters {
  return {
    ruleKind: args.ruleKind,
    productScope: args.productScope,
    q: args.q,
    sort: args.sort,
    page: args.page,
    perPage: args.perPage,
  };
}
