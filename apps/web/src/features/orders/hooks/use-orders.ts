'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { keepPreviousWithinStore } from '@/lib/query-scope-placeholder';

import { listOrders, type ListOrdersArgs, type ListOrdersResponse } from '../api/list-orders.api';
import { orderKeys, type OrderListFilters } from '../query-keys';
import type { FinalizingPoll } from './use-finalizing-poll';

export interface UseOrdersOptions {
  /**
   * The list half of the page's finalizing poll: fed the latest response's
   * `openDay.finalizing`, it returns the refetch interval. Without it the list
   * does not poll.
   */
  pollInterval?: FinalizingPoll['fromList'];
}

/**
 * Lists orders for a store. Disabled when args is null (no active org/store
 * resolved yet) — avoids a wasted fetch + reads cleanly during cold load.
 * placeholderData keeps the previous page on screen during filter, sort and
 * page changes within the store, including its `openDay`, so the open-day
 * notice does not blink out while the next page loads.
 *
 * The poll is fed only by responses for the current key. The placeholder lives
 * on the observer, not on the new key's query, so while the next page loads
 * `query.state.data` is undefined; feeding that to the poll would close its
 * window and restart the cap when the page lands. The list waits instead, and
 * the summary keeps the last recorded value.
 */
export function useOrders(
  args: ListOrdersArgs | null,
  options?: UseOrdersOptions,
): UseQueryResult<ListOrdersResponse> {
  const pollInterval = options?.pollInterval;
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
    // Keep the previous page for smooth in-store swaps, but drop it on a store
    // switch so another store's rows never flash on this store's screen.
    placeholderData: keepPreviousWithinStore<ListOrdersResponse>(args?.storeId ?? ''),
    refetchInterval:
      pollInterval !== undefined
        ? (query) =>
            query.state.data === undefined
              ? false
              : pollInterval(query.state.data.openDay.finalizing)
        : false,
  });
}

function argsToFilters(args: ListOrdersArgs): OrderListFilters {
  return {
    status: args.status ?? '',
    reconciliationStatus: args.reconciliationStatus ?? '',
    costStatus: args.costStatus ?? '',
    lossOnly: args.lossOnly ?? false,
    from: args.from ?? '',
    to: args.to ?? '',
    sort: args.sort ?? '',
    q: args.q ?? '',
    page: args.page,
    perPage: args.perPage,
  };
}
