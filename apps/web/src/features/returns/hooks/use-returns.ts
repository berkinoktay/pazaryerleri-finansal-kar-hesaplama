'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { keepPreviousWithinStore } from '@/lib/query-scope-placeholder';

import { listClaims, type ListClaimsArgs, type ListClaimsResponse } from '../api/list-claims.api';
import { returnKeys, type ClaimListFilters } from '../query-keys';

/**
 * Lists return claims for a store. Disabled when args is null (no active
 * org/store resolved yet) — avoids a wasted fetch + reads cleanly during
 * cold load. placeholderData keeps the previous page on screen during
 * tab/page transitions so the table doesn't collapse to a skeleton.
 */
export function useReturns(args: ListClaimsArgs | null): UseQueryResult<ListClaimsResponse> {
  return useQuery<ListClaimsResponse>({
    queryKey:
      args !== null
        ? returnKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : ['returns', 'list', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useReturns called with null args');
      return listClaims(args);
    },
    enabled: args !== null,
    // Keep the previous page for smooth in-store pagination, but drop it on a
    // store switch so another store's rows never flash on this store's screen.
    placeholderData: keepPreviousWithinStore<ListClaimsResponse>(args?.storeId ?? ''),
  });
}

function argsToFilters(args: ListClaimsArgs): ClaimListFilters {
  return {
    status: args.status ?? '',
    from: args.from ?? '',
    to: args.to ?? '',
    q: args.q ?? '',
    page: args.page,
    perPage: args.perPage,
  };
}
