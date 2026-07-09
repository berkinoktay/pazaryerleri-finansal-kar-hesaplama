/**
 * React Query key factory for the costs feature.
 *
 * Keys are verbatim from spec §7.5. Every cache invalidation in mutation
 * hooks references this factory — no string-literal key arrays in hook files.
 *
 * Invalidation contract: the org-scoped `profiles(orgId)` form is a STRICT
 * PREFIX of the filter-arg `profilesList(orgId, filters)` form. React Query's
 * prefix-match invalidation requires this — passing `undefined` in a filter slot
 * does NOT partial-match a real filter object, it would match nothing. Mutations
 * call `profiles(orgId)` to invalidate the entire list family across all filter
 * combos for that org.
 *
 * Tenant scoping: `profilesList` and `missingCostStats` fetch org-scoped
 * endpoints (`/v1/organizations/{orgId}/...`), so their keys MUST carry `orgId`.
 * Without it, switching the active org served the PREVIOUS org's cost profiles
 * (competitive cost intelligence — see docs/SECURITY.md) from cache, because a
 * store/org switch only calls router.refresh() and does not reset the React
 * Query cache. Entity-UUID keys (`profile`, `variantAttachments`) stay id-only:
 * a UUID belongs to exactly one org, so there is no cross-org collision.
 */

import type { ListCostProfileFilters } from '../types/cost-profile.types';

export const costsKeys = {
  all: ['costs'] as const,
  profiles: (orgId: string) => [...costsKeys.all, 'profiles', orgId] as const,
  profilesList: (orgId: string, filters?: ListCostProfileFilters) =>
    [...costsKeys.profiles(orgId), filters] as const,
  profile: (id: string) => [...costsKeys.all, 'profile', id] as const,
  profileVersions: (id: string) => [...costsKeys.profile(id), 'versions'] as const,
  profileAttachedVariants: (id: string) => [...costsKeys.profile(id), 'attached-variants'] as const,
  variantAttachments: (vid: string) => [...costsKeys.all, 'variant', vid] as const,
  fxRatesLatest: (orgId: string) => [...costsKeys.all, 'fx-rates', 'latest', orgId] as const,
  missingCostStats: (orgId: string) => [...costsKeys.all, 'missing-stats', orgId] as const,
};
