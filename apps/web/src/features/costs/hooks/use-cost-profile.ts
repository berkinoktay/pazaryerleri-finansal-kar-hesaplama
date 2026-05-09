'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getCostProfile } from '../api/get-cost-profile.api';
import type { CostProfile } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

export function useCostProfile(
  orgId: string | null,
  profileId: string | null,
): UseQueryResult<CostProfile> {
  return useQuery<CostProfile>({
    queryKey:
      profileId !== null ? costsKeys.profile(profileId) : ['costs', 'profile', '__disabled__'],
    queryFn: () => {
      if (orgId === null || profileId === null)
        throw new Error('useCostProfile called with null args');
      return getCostProfile(orgId, profileId);
    },
    enabled: orgId !== null && profileId !== null,
  });
}
