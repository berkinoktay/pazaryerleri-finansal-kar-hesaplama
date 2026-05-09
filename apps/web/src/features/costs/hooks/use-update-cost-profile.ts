'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateCostProfile, type UpdateCostProfileArgs } from '../api/update-cost-profile.api';
import type { CostProfile } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

/**
 * Mutation hook for updating a cost profile.
 *
 * Invalidation matrix (spec §7.6):
 *   - profile(id) — refresh the detail view
 *   - profileVersions(id) — new version row was inserted
 *   - profiles() — name/amount shown in the list may have changed
 *   - ['products'] — live currentCostTry in the products table may have changed
 *
 * The ['products'] invalidation uses a string literal instead of importing
 * productKeys from @/features/products to keep the cross-feature audit clean
 * (audit-boundaries blocks runtime imports between feature slices). The
 * string is the leading element of products' query-key factory; both keys
 * stay in sync via the convention that every feature's keys.all = [<feature>].
 *
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function useUpdateCostProfile() {
  const queryClient = useQueryClient();

  return useMutation<CostProfile, Error, UpdateCostProfileArgs>({
    mutationFn: updateCostProfile,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: costsKeys.profile(variables.profileId) });
      void queryClient.invalidateQueries({
        queryKey: costsKeys.profileVersions(variables.profileId),
      });
      void queryClient.invalidateQueries({ queryKey: costsKeys.profiles() });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
