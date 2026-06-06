'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getLiveKpis, type LivePerformanceKpis } from '../api/get-live-kpis.api';
import { LIVE_QUERY_STALE_MS, liveKeys } from '../query-keys';

/**
 * Today-vs-yesterday KPI tile data. Disabled until an org + store resolve
 * (cold load / no store selected), avoiding a wasted fetch.
 */
export function useLiveKpis(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<LivePerformanceKpis> {
  const enabled = orgId !== null && storeId !== null;
  return useQuery<LivePerformanceKpis>({
    queryKey: enabled ? liveKeys.kpis(orgId, storeId) : [...liveKeys.all, 'kpis', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null)
        throw new Error('useLiveKpis called without org/store');
      return getLiveKpis({ orgId, storeId });
    },
    enabled,
    staleTime: LIVE_QUERY_STALE_MS,
  });
}
