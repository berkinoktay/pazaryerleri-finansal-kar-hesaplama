'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getMissingCostStats, type MissingCostStats } from '../api/get-missing-cost-stats.api';

import { costsKeys } from './costs-keys';

/**
 * Narrow the org-wide stats to a single store's slice. The endpoint returns a
 * `byStore` breakdown (every accessible store, each with its own missingCount +
 * totalVariants), so a store-scoped consumer picks its store's row and presents
 * it as the top-level count/totalVariants — "N missing of M" for the ACTIVE
 * store only, never mixing in other stores' variants.
 */
function selectStoreSlice(data: MissingCostStats, storeId: string): MissingCostStats {
  const entry = data.byStore.find((s) => s.storeId === storeId);
  return {
    count: entry?.missingCount ?? 0,
    totalVariants: entry?.totalVariants ?? 0,
    byStore: entry ? [entry] : [],
  };
}

/**
 * Missing-cost stats. Pass `storeId` to scope the returned count/totalVariants
 * to the active store (the default for every store-context surface — banner,
 * dashboard widget). Omit it only for a genuine org-wide aggregate. The fetch is
 * org-wide and shared across consumers (keyed by orgId); `select` derives each
 * consumer's store slice from the same cached response, so switching store
 * re-selects without a refetch.
 */
export function useMissingCostStats(
  orgId: string | null,
  storeId?: string,
): UseQueryResult<MissingCostStats> {
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
    ...(storeId !== undefined ? { select: (data) => selectStoreSlice(data, storeId) } : {}),
  });
}
