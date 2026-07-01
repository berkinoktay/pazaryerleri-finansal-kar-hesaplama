// Query-key factory for the commission-tariffs feature. Mirrors the convention
// in features/product-pricing/query-keys.ts so React Query invalidation reads
// predictably across the codebase. The list has no server-side filters
// (filtering/sorting is client-side over the backend-computed rows), so the list
// key needs only the store scope.

export const commissionTariffKeys = {
  all: ['commission-tariffs'] as const,
  lists: (orgId: string, storeId: string) =>
    [...commissionTariffKeys.all, 'list', orgId, storeId] as const,
  details: (orgId: string, storeId: string) =>
    [...commissionTariffKeys.all, 'detail', orgId, storeId] as const,
  detail: (orgId: string, storeId: string, tariffId: string) =>
    [...commissionTariffKeys.details(orgId, storeId), tariffId] as const,
};
