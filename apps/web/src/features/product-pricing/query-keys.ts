// Query key factory for the product-pricing feature. Mirrors the
// convention in features/commission-rates/query-keys.ts so React Query
// invalidation reads predictably across the codebase.

/**
 * Sort vocabulary — a strict subset of the backend `sortBy` enum
 * (api.d.ts). Skeleton wires only the columns we expose as sortable
 * headers; the filter dimensions (profitStatus/margin/category/brand)
 * land in a later slice.
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

export interface ProductPricingListFilters {
  sortBy: ProductPricingSort;
  page: number;
  perPage: number;
}

export const productPricingKeys = {
  all: ['product-pricing'] as const,
  lists: (orgId: string, storeId: string) =>
    [...productPricingKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: ProductPricingListFilters) =>
    [...productPricingKeys.lists(orgId, storeId), filters] as const,
};
