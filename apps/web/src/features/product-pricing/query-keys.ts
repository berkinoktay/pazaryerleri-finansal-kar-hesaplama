// Query key factory for the product-pricing feature. Mirrors the
// convention in features/commission-rates/query-keys.ts so React Query
// invalidation reads predictably across the codebase.

/**
 * Sort vocabulary — a strict subset of the backend `sortBy` enum (api.d.ts).
 * Covers the columns exposed as sortable headers in the product-pricing table.
 */
export type ProductPricingSort =
  | 'salePrice:asc'
  | 'salePrice:desc'
  | 'title:asc'
  | 'title:desc'
  | 'netProfit:asc'
  | 'netProfit:desc'
  | 'saleMarginPct:asc'
  | 'saleMarginPct:desc'
  | 'costMarkupPct:asc'
  | 'costMarkupPct:desc';

/**
 * Forward-profit direction filter. Mirrors the backend `profitStatus`
 * query enum: `all` applies no filter; the other three narrow to
 * calculable rows whose net profit is > 0 / = 0 / < 0.
 */
export type ProductPricingProfitStatus = 'all' | 'profitable' | 'breakeven' | 'loss';

export interface ProductPricingListFilters {
  sortBy: ProductPricingSort;
  q: string;
  /** When true, the query sends `profitStatus: 'loss'`; false omits the filter (all). */
  lossOnly: boolean;
  marginMin: string;
  marginMax: string;
  categoryId: string;
  brandId: string;
  page: number;
  perPage: number;
}

export const productPricingKeys = {
  all: ['product-pricing'] as const,
  lists: (orgId: string, storeId: string) =>
    [...productPricingKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: ProductPricingListFilters) =>
    [...productPricingKeys.lists(orgId, storeId), filters] as const,
  facets: (orgId: string, storeId: string) =>
    [...productPricingKeys.all, 'facets', orgId, storeId] as const,
};
