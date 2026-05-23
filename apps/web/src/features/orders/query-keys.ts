// Query key factory for the orders feature. Mirrors features/products/query-keys.ts
// so React Query invalidation reads consistently across the codebase.

export interface OrderListFilters {
  status: string;
  reconciliationStatus: string;
  from: string;
  to: string;
  q: string;
  page: number;
  perPage: number;
}

export const orderKeys = {
  all: ['orders'] as const,
  lists: (orgId: string, storeId: string) => [...orderKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: OrderListFilters) =>
    [...orderKeys.lists(orgId, storeId), filters] as const,
  details: (orgId: string, storeId: string) =>
    [...orderKeys.all, 'detail', orgId, storeId] as const,
  detail: (orgId: string, storeId: string, orderId: string) =>
    [...orderKeys.details(orgId, storeId), orderId] as const,
};
