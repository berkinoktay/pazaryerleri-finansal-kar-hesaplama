// Query key factory for the orders feature. Mirrors features/products/query-keys.ts
// so React Query invalidation reads consistently across the codebase.

export interface OrderListFilters {
  status: string;
  reconciliationStatus: string;
  costStatus: string;
  lossOnly: boolean;
  from: string;
  to: string;
  sort: string;
  q: string;
  page: number;
  perPage: number;
}

// Summary (KPI) shares the list filters but not pagination/sort.
export type OrderSummaryFilters = Omit<OrderListFilters, 'page' | 'perPage' | 'sort'>;

export const orderKeys = {
  all: ['orders'] as const,
  lists: (orgId: string, storeId: string) => [...orderKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: OrderListFilters) =>
    [...orderKeys.lists(orgId, storeId), filters] as const,
  summaries: (orgId: string, storeId: string) =>
    [...orderKeys.all, 'summary', orgId, storeId] as const,
  summary: (orgId: string, storeId: string, filters: OrderSummaryFilters) =>
    [...orderKeys.summaries(orgId, storeId), filters] as const,
  details: (orgId: string, storeId: string) =>
    [...orderKeys.all, 'detail', orgId, storeId] as const,
  detail: (orgId: string, storeId: string, orderId: string) =>
    [...orderKeys.details(orgId, storeId), orderId] as const,
};
