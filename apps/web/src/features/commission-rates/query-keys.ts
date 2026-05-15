// Query key factory for the commission-rates feature. Mirrors the
// convention in features/products/query-keys.ts so React Query
// invalidation reads predictably across the codebase.
//
// Note: the cursor is intentionally NOT part of the filters object —
// useInfiniteQuery owns cursor lifecycle via pageParam. Including
// `cursor` in the queryKey would prevent the infinite cache from
// stitching pages together.

export type CommissionRateRuleKind = 'CATEGORY' | 'CATEGORY_BRAND';
export type CommissionRateProductScope = 'all' | 'active';
export type CommissionRateSort =
  | 'category_name:asc'
  | 'base_rate:asc'
  | 'base_rate:desc'
  | 'product_count:desc';

export interface CommissionRateListFilters {
  ruleKind: CommissionRateRuleKind;
  productScope: CommissionRateProductScope;
  q?: string;
  sort: CommissionRateSort;
}

export const commissionRateKeys = {
  all: ['commission-rates'] as const,
  lists: (orgId: string, storeId: string) =>
    [...commissionRateKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: CommissionRateListFilters) =>
    [...commissionRateKeys.lists(orgId, storeId), filters] as const,
};
