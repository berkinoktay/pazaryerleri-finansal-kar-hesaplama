'use client';

import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
  type Values,
} from 'nuqs';

import type { ProductPricingProfitStatus, ProductPricingSort } from '../query-keys';

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

export const PRODUCT_PRICING_PROFIT_STATUSES: readonly ProductPricingProfitStatus[] = [
  'all',
  'profitable',
  'breakeven',
  'loss',
];
export const PRODUCT_PRICING_DEFAULT_PROFIT_STATUS: ProductPricingProfitStatus = 'all';

export const productPricingFiltersParsers = {
  sortBy: parseAsStringEnum<ProductPricingSort>([...PRODUCT_PRICING_SORTS]).withDefault(
    PRODUCT_PRICING_DEFAULT_SORT,
  ),
  q: parseAsString.withDefault(''),
  profitStatus: parseAsStringEnum<ProductPricingProfitStatus>([
    ...PRODUCT_PRICING_PROFIT_STATUSES,
  ]).withDefault(PRODUCT_PRICING_DEFAULT_PROFIT_STATUS),
  marginMin: parseAsString.withDefault(''),
  marginMax: parseAsString.withDefault(''),
  categoryId: parseAsString.withDefault(''),
  brandId: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(PRODUCT_PRICING_DEFAULT_PER_PAGE),
};

export type ProductPricingFilters = Values<typeof productPricingFiltersParsers>;
type FiltersUpdater = Partial<ProductPricingFilters>;

/**
 * Keys whose change resets `page` to 1 — every non-pagination filter plus
 * `perPage` (which re-slices the result set). Changing only `page` itself
 * obviously must NOT reset the page.
 */
const PAGE_RESETTING_KEYS: readonly (keyof ProductPricingFilters)[] = [
  'sortBy',
  'q',
  'profitStatus',
  'marginMin',
  'marginMax',
  'categoryId',
  'brandId',
  'perPage',
];

/**
 * URL ↔ filter state binding via nuqs. Changing any non-pagination filter
 * (sort, search, profit status, margin range, category, brand) — or `perPage`
 * — resets `page` to 1 so the user never lands on an empty page after
 * narrowing or re-ordering the result set.
 */
export function useProductPricingFilters(): {
  filters: ProductPricingFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(productPricingFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter = PAGE_RESETTING_KEYS.some((key) => key in next);
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  return { filters, setFilters };
}
