'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getCostProfileVersions } from '../api/get-cost-profile-versions.api';
import type { ListCostProfileVersionsResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

export function useCostProfileVersions(
  orgId: string | null,
  profileId: string | null,
): UseQueryResult<ListCostProfileVersionsResponse> {
  return useQuery<ListCostProfileVersionsResponse>({
    queryKey:
      profileId !== null
        ? costsKeys.profileVersions(profileId)
        : ['costs', 'profile', '__disabled__', 'versions'],
    queryFn: () => {
      if (orgId === null || profileId === null)
        throw new Error('useCostProfileVersions called with null args');
      return getCostProfileVersions({ orgId, profileId });
    },
    enabled: orgId !== null && profileId !== null,
  });
}
