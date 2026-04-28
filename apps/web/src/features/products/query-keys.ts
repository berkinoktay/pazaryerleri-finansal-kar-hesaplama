// Query key factory for the products feature. Mirrors the convention
// established in features/stores/query-keys.ts so React Query
// invalidation reads predictably across the codebase.

export interface ProductListFilters {
  q?: string;
  status?: string;
  brandId?: string;
  categoryId?: string;
  page: number;
  perPage: number;
  sort: string;
}

export const productKeys = {
  all: ['products'] as const,
  lists: (orgId: string, storeId: string) => [...productKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: ProductListFilters) =>
    [...productKeys.lists(orgId, storeId), filters] as const,
  facets: (orgId: string, storeId: string) =>
    [...productKeys.all, 'facets', orgId, storeId] as const,
};
