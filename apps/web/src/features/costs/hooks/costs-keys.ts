/**
 * React Query key factory for the costs feature.
 *
 * Keys are verbatim from spec §7.5. Every cache invalidation in mutation
 * hooks references this factory — no string-literal key arrays in hook files.
 *
 * Invalidation contract: the no-arg `profiles()` form is a STRICT PREFIX of
 * the filter-arg `profilesList(filters)` form. React Query's prefix-match
 * invalidation requires this — passing `undefined` in a filter slot does NOT
 * partial-match a real filter object, it would match nothing. Mutations call
 * `profiles()` to invalidate the entire list family across all filter combos.
 */

import type { ListCostProfileFilters } from '../types/cost-profile.types';

export const costsKeys = {
  all: ['costs'] as const,
  profiles: () => [...costsKeys.all, 'profiles'] as const,
  profilesList: (filters?: ListCostProfileFilters) => [...costsKeys.profiles(), filters] as const,
  profile: (id: string) => [...costsKeys.all, 'profile', id] as const,
  profileVersions: (id: string) => [...costsKeys.profile(id), 'versions'] as const,
  profileAttachedVariants: (id: string) => [...costsKeys.profile(id), 'attached-variants'] as const,
  variantAttachments: (vid: string) => [...costsKeys.all, 'variant', vid] as const,
  fxRatesLatest: (orgId: string) => [...costsKeys.all, 'fx-rates', 'latest', orgId] as const,
  missingCostStats: () => [...costsKeys.all, 'missing-stats'] as const,
};
