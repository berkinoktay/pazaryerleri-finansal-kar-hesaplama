'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listCostProfiles } from '../api/list-cost-profiles.api';
import type { ListCostProfileFilters, ListCostProfilesResponse } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

export interface UseCostProfilesArgs {
  orgId: string;
  filters?: ListCostProfileFilters;
}

export function useCostProfiles(
  args: UseCostProfilesArgs | null,
): UseQueryResult<ListCostProfilesResponse> {
  return useQuery<ListCostProfilesResponse>({
    queryKey:
      args !== null ? costsKeys.profiles(args.filters) : ['costs', 'profiles', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useCostProfiles called with null args');
      return listCostProfiles({ orgId: args.orgId, filters: args.filters });
    },
    enabled: args !== null,
  });
}
