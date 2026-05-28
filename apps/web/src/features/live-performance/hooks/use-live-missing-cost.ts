'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getLiveMissingCost,
  type LivePerformanceMissingCost,
} from '../api/get-live-missing-cost.api';
import { LIVE_QUERY_STALE_MS, liveKeys } from '../query-keys';

/** Variant-grouped cost-missing list for today. Disabled until org + store resolve. */
export function useLiveMissingCost(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<LivePerformanceMissingCost> {
  const enabled = orgId !== null && storeId !== null;
  return useQuery<LivePerformanceMissingCost>({
    queryKey: enabled
      ? liveKeys.missingCost(orgId, storeId)
      : [...liveKeys.all, 'missing-cost', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useLiveMissingCost called without org/store');
      }
      return getLiveMissingCost({ orgId, storeId });
    },
    enabled,
    staleTime: LIVE_QUERY_STALE_MS,
  });
}
