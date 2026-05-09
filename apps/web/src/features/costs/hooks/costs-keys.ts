/**
 * React Query key factory for the costs feature.
 *
 * Keys are verbatim from spec §7.5. Every cache invalidation in mutation
 * hooks references this factory — no string-literal key arrays in hook files.
 */

import type { ListCostProfileFilters } from '../types/cost-profile.types';

export const costsKeys = {
  all: ['costs'] as const,
  profiles: (filters?: ListCostProfileFilters) => [...costsKeys.all, 'profiles', filters] as const,
  profile: (id: string) => [...costsKeys.all, 'profile', id] as const,
  profileVersions: (id: string) => [...costsKeys.profile(id), 'versions'] as const,
  profileAttachedVariants: (id: string) => [...costsKeys.profile(id), 'attached-variants'] as const,
  variantAttachments: (vid: string) => [...costsKeys.all, 'variant', vid] as const,
  fxRatesLatest: () => [...costsKeys.all, 'fx-rates', 'latest'] as const,
  missingCostStats: () => [...costsKeys.all, 'missing-stats'] as const,
};
