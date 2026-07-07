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

// Plus commission tariffs are a separate saved-upload family (Plus offers: price
// ceiling + reduced commission), so they get their own key namespace. Same shape
// as commissionTariffKeys — only the root segment differs, keeping invalidation of
// the two families independent.
export const plusCommissionTariffKeys = {
  all: ['plus-commission-tariffs'] as const,
  lists: (orgId: string, storeId: string) =>
    [...plusCommissionTariffKeys.all, 'list', orgId, storeId] as const,
  details: (orgId: string, storeId: string) =>
    [...plusCommissionTariffKeys.all, 'detail', orgId, storeId] as const,
  detail: (orgId: string, storeId: string, tariffId: string) =>
    [...plusCommissionTariffKeys.details(orgId, storeId), tariffId] as const,
};

// Advantage product-label tariffs (Avantajlı Ürün Etiketleri) are their own
// saved-upload family: each product picks one of three star tiers and the reduced
// commission is READ from the store's commission-tariff data. They get an
// independent key namespace — same shape as the plus family, only the root segment
// differs — so invalidating one family never touches the others.
export const advantageTariffKeys = {
  all: ['advantage-tariffs'] as const,
  lists: (orgId: string, storeId: string) =>
    [...advantageTariffKeys.all, 'list', orgId, storeId] as const,
  details: (orgId: string, storeId: string) =>
    [...advantageTariffKeys.all, 'detail', orgId, storeId] as const,
  detail: (orgId: string, storeId: string, tariffId: string) =>
    [...advantageTariffKeys.details(orgId, storeId), tariffId] as const,
};

// Flash Products (Flaş Ürünler) uploads are their own saved-upload family: each row is
// one product × one date carrying up to two dated flash offers, and the reduced
// commission is AUTO-resolved per row from the store's commission-tariff data. They get
// an independent key namespace — same shape as the other families, only the root segment
// differs — so invalidating one family never touches the others. `listId` (not
// `tariffId`) matches the backend's route param for the detail/selections/export routes.
export const flashProductKeys = {
  all: ['flash-products'] as const,
  lists: (orgId: string, storeId: string) =>
    [...flashProductKeys.all, 'list', orgId, storeId] as const,
  details: (orgId: string, storeId: string) =>
    [...flashProductKeys.all, 'detail', orgId, storeId] as const,
  detail: (orgId: string, storeId: string, listId: string) =>
    [...flashProductKeys.details(orgId, storeId), listId] as const,
};
