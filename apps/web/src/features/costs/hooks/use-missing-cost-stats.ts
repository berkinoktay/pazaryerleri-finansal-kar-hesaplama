'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getMissingCostStats, type MissingCostStats } from '../api/get-missing-cost-stats.api';

import { costsKeys } from './costs-keys';

export function useMissingCostStats(orgId: string | null): UseQueryResult<MissingCostStats> {
  return useQuery<MissingCostStats>({
    queryKey:
      orgId !== null
        ? costsKeys.missingCostStats(orgId)
        : ['costs', 'missing-stats', '__disabled__'],
    queryFn: () => {
      if (orgId === null) throw new Error('useMissingCostStats called with null orgId');
      return getMissingCostStats(orgId);
    },
    enabled: orgId !== null,
  });
}
