'use client';

import { useQueryStates, type Values } from 'nuqs';

import { productsFiltersParsers, type ProductsFilters } from '../lib/products-filter-parsers';

type FiltersValues = Values<typeof productsFiltersParsers>;
type FiltersUpdater = Partial<Values<typeof productsFiltersParsers>>;

/**
 * URL ↔ filter state binding via nuqs. Page back/forward replays the
 * exact view; deep links reproduce filtered tables; filter changes
 * navigate via `history.push` so the browser back button works.
 *
 * Setters that touch any non-pagination filter automatically reset
 * `page` to 1 — otherwise the user clicks "brand: Modline" while on
 * page 4, lands on a 12-row dataset that has no page 4, and sees an
 * empty table.
 */
export function useProductsFilters(): {
  filters: ProductsFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
  resetPagination: () => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(productsFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter =
      'q' in next ||
      'status' in next ||
      'brandId' in next ||
      'categoryId' in next ||
      'overrideMissing' in next ||
      'sort' in next;
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  const resetPagination = (): Promise<URLSearchParams> => setRaw({ page: 1 });

  return { filters: filters as FiltersValues, setFilters, resetPagination };
}
