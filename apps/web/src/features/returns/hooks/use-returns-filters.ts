'use client';

import { useQueryStates, type Values } from 'nuqs';

import { returnsFiltersParsers, type ReturnsFilters } from '../lib/returns-filter-parsers';

type FiltersValues = Values<typeof returnsFiltersParsers>;
type FiltersUpdater = Partial<Values<typeof returnsFiltersParsers>>;

/**
 * URL ↔ filter state binding via nuqs. Mirrors useOrdersFilters: any non-
 * pagination filter change resets `page` to 1 so the user doesn't land on
 * an empty page after narrowing the result set.
 */
export function useReturnsFilters(): {
  filters: ReturnsFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(returnsFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter =
      'q' in next || 'status' in next || 'from' in next || 'to' in next;
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  return { filters: filters as FiltersValues, setFilters };
}
