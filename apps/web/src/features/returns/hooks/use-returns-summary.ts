'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getClaimsSummary,
  type ClaimsSummary,
  type GetClaimsSummaryArgs,
} from '../api/get-claims-summary.api';
import { returnKeys } from '../query-keys';

/**
 * Returns-page KPI summary. Disabled when args is null (no active org/store
 * resolved yet) — mirrors useReturns.
 */
export function useReturnsSummary(
  args: GetClaimsSummaryArgs | null,
): UseQueryResult<ClaimsSummary> {
  return useQuery<ClaimsSummary>({
    queryKey:
      args !== null
        ? returnKeys.summary(args.orgId, args.storeId, {
            from: args.from ?? '',
            to: args.to ?? '',
          })
        : ['returns', 'summary', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useReturnsSummary called with null args');
      return getClaimsSummary(args);
    },
    enabled: args !== null,
  });
}
