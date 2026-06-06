// Query key factory for the live-performance feature. Mirrors
// features/orders/query-keys.ts so React Query invalidation reads consistently
// across the codebase. All keys are org + store scoped (the page is
// store-scoped) so switching store never reads another store's cache.

export type LiveOrdersFilter = 'all' | 'calculated' | 'pending';

/**
 * Stale window for the live queries. Realtime invalidation keeps the data
 * fresh on every relevant DB change; this only governs refetch-on-remount /
 * refocus between events, so a modest window avoids redundant fetches without
 * letting the surface go stale when Realtime is down (the health-gated polling
 * fallback covers that case).
 */
export const LIVE_QUERY_STALE_MS = 30_000;

/**
 * Polling-fallback cadence used ONLY while the Realtime channel is unhealthy
 * (errored). When Realtime is delivering events we don't poll at all — the
 * subscription invalidates on every change. Matches the 10s tempo OrgSyncsProvider
 * settled on (a true fallback, not the primary freshness mechanism).
 */
export const LIVE_POLL_INTERVAL_MS = 10_000;

export const liveKeys = {
  all: ['live-performance'] as const,
  kpis: (orgId: string, storeId: string) => [...liveKeys.all, 'kpis', orgId, storeId] as const,
  chart: (orgId: string, storeId: string) => [...liveKeys.all, 'chart', orgId, storeId] as const,
  todayProducts: (orgId: string, storeId: string) =>
    [...liveKeys.all, 'today-products', orgId, storeId] as const,
  orders: (orgId: string, storeId: string, filter: LiveOrdersFilter = 'all') =>
    [...liveKeys.all, 'orders', orgId, storeId, filter] as const,
  bufferDetail: (orgId: string, storeId: string, bufferId: string) =>
    [...liveKeys.all, 'buffer-detail', orgId, storeId, bufferId] as const,
  notificationSummary: (orgId: string, storeId: string, source: 'orders' | 'buffer', id: string) =>
    [...liveKeys.all, 'notification-summary', orgId, storeId, source, id] as const,
};
