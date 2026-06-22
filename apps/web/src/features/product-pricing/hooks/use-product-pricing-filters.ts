'use client';

import { parseAsInteger, parseAsStringEnum, useQueryStates, type Values } from 'nuqs';

import type { ProductPricingSort } from '../query-keys';

export const PRODUCT_PRICING_SORTS: readonly ProductPricingSort[] = [
  'salePrice:asc',
  'salePrice:desc',
  'title:asc',
  'title:desc',
  'netProfit:asc',
  'netProfit:desc',
  'saleMarginPct:asc',
  'saleMarginPct:desc',
  'costMarkupPct:asc',
  'costMarkupPct:desc',
];
export const PRODUCT_PRICING_PER_PAGE_OPTIONS: readonly number[] = [10, 25, 50, 100];
export const PRODUCT_PRICING_DEFAULT_PER_PAGE = 25;
export const PRODUCT_PRICING_DEFAULT_SORT: ProductPricingSort = 'title:asc';

export const productPricingFiltersParsers = {
  sortBy: parseAsStringEnum<ProductPricingSort>([...PRODUCT_PRICING_SORTS]).withDefault(
    PRODUCT_PRICING_DEFAULT_SORT,
  ),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(PRODUCT_PRICING_DEFAULT_PER_PAGE),
};

export type ProductPricingFilters = Values<typeof productPricingFiltersParsers>;
type FiltersUpdater = Partial<ProductPricingFilters>;

/**
 * URL ↔ filter state binding via nuqs. Changing the sort (or any future
 * non-pagination filter) resets `page` to 1 so the user never lands on an
 * empty page after re-ordering the result set.
 */
export function useProductPricingFilters(): {
  filters: ProductPricingFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(productPricingFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter = 'sortBy' in next || 'perPage' in next;
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  return { filters, setFilters };
}
