'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getVariantCostProfiles } from '../api/get-variant-cost-profiles.api';
import type { ListVariantCostProfilesResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

export interface UseVariantCostProfilesArgs {
  orgId: string;
  variantId: string;
}

/**
 * Query hook for the list of cost profiles attached to a product variant.
 * Used by the cost-cell popover to render the attached profiles list and
 * provide the full profile details (name, type, amount) for display.
 */
export function useVariantCostProfiles(
  args: UseVariantCostProfilesArgs | null,
): UseQueryResult<ListVariantCostProfilesResponse> {
  return useQuery<ListVariantCostProfilesResponse>({
    queryKey:
      args !== null
        ? costsKeys.variantAttachments(args.variantId)
        : ['costs', 'variant', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useVariantCostProfiles called with null args');
      return getVariantCostProfiles({ orgId: args.orgId, variantId: args.variantId });
    },
    enabled: args !== null,
  });
}
