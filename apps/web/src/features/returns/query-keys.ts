// Query key factory for the returns feature. Mirrors features/orders/query-keys.ts
// so React Query invalidation reads consistently across the codebase.

export interface ClaimListFilters {
  status: string;
  from: string;
  to: string;
  q: string;
  page: number;
  perPage: number;
}

export const returnKeys = {
  all: ['returns'] as const,
  lists: (orgId: string, storeId: string) => [...returnKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: ClaimListFilters) =>
    [...returnKeys.lists(orgId, storeId), filters] as const,
  summaries: (orgId: string, storeId: string) =>
    [...returnKeys.all, 'summary', orgId, storeId] as const,
  summary: (orgId: string, storeId: string, range: { from: string; to: string }) =>
    [...returnKeys.summaries(orgId, storeId), range] as const,
};
