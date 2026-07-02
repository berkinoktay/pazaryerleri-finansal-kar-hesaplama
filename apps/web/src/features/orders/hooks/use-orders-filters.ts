'use client';

import { useQueryStates, type Values } from 'nuqs';

import { ordersFiltersParsers, type OrdersFilters } from '../lib/orders-filter-parsers';

type FiltersValues = Values<typeof ordersFiltersParsers>;
type FiltersUpdater = Partial<Values<typeof ordersFiltersParsers>>;

/**
 * URL ↔ filter state binding via nuqs. Mirrors useProductsFilters: any non-
 * pagination filter change resets `page` to 1 so the user doesn't land on
 * an empty page after narrowing the result set.
 */
export function useOrdersFilters(): {
  filters: OrdersFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
  resetPagination: () => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(ordersFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter =
      'q' in next ||
      'status' in next ||
      'reconciliationStatus' in next ||
      'costStatus' in next ||
      // lossOnly was missing here — toggling it on page 4 used to leave the
      // user on a page that may no longer exist.
      'lossOnly' in next ||
      'from' in next ||
      'to' in next ||
      'sort' in next;
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  const resetPagination = (): Promise<URLSearchParams> => setRaw({ page: 1 });

  return { filters: filters as FiltersValues, setFilters, resetPagination };
}
