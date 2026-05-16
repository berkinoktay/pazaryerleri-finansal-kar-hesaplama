// Query key factory for the commission-rates feature. Mirrors the
// convention in features/products/query-keys.ts so React Query
// invalidation reads predictably across the codebase.

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
  page: number;
  perPage: number;
}

export const commissionRateKeys = {
  all: ['commission-rates'] as const,
  lists: (orgId: string, storeId: string) =>
    [...commissionRateKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: CommissionRateListFilters) =>
    [...commissionRateKeys.lists(orgId, storeId), filters] as const,
};
