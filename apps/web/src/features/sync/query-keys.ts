// Query key factory for the org-wide sync feature. Mirrors the
// convention established in features/products/query-keys.ts so React
// Query invalidation reads predictably across the codebase.

export const orgSyncKeys = {
  all: ['org-syncs'] as const,
  list: (orgId: string) => [...orgSyncKeys.all, orgId] as const,
};
