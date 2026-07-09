'use client';

import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseQueryResult,
} from '@tanstack/react-query';

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
      args !== null
        ? costsKeys.profilesList(args.orgId, args.filters)
        : ['costs', 'profiles', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useCostProfiles called with null args');
      return listCostProfiles({ orgId: args.orgId, filters: args.filters });
    },
    enabled: args !== null,
  });
}

/**
 * Cursor-paginated variant of the profiles list. The list endpoint is
 * cursor-based (CursorMeta.nextCursor) — the old single-page useQuery made
 * every profile beyond the first page unreachable from the UI. Pages are
 * flattened by the consumer; `fetchNextPage` drives the load-more footer.
 */
export function useCostProfilesInfinite(
  args: UseCostProfilesArgs | null,
): UseInfiniteQueryResult<InfiniteData<ListCostProfilesResponse>> {
  return useInfiniteQuery<
    ListCostProfilesResponse,
    Error,
    InfiniteData<ListCostProfilesResponse>,
    readonly unknown[],
    string | undefined
  >({
    queryKey:
      args !== null
        ? ([...costsKeys.profilesList(args.orgId, args.filters), 'infinite'] as const)
        : (['costs', 'profiles', '__disabled__', 'infinite'] as const),
    queryFn: ({ pageParam }) => {
      if (args === null) throw new Error('useCostProfilesInfinite called with null args');
      return listCostProfiles({
        orgId: args.orgId,
        filters: { ...args.filters, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
      });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled: args !== null,
  });
}
