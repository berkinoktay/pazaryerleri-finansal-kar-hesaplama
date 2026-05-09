'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getCostProfileAttachedVariants } from '../api/get-cost-profile-attached-variants.api';
import type { ListAttachedVariantsResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

export function useCostProfileAttachedVariants(
  orgId: string | null,
  profileId: string | null,
): UseQueryResult<ListAttachedVariantsResponse> {
  return useQuery<ListAttachedVariantsResponse>({
    queryKey:
      profileId !== null
        ? costsKeys.profileAttachedVariants(profileId)
        : ['costs', 'profile', '__disabled__', 'attached-variants'],
    queryFn: () => {
      if (orgId === null || profileId === null)
        throw new Error('useCostProfileAttachedVariants called with null args');
      return getCostProfileAttachedVariants({ orgId, profileId });
    },
    enabled: orgId !== null && profileId !== null,
  });
}
