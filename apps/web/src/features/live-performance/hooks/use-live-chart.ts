'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getLiveChart, type LivePerformanceChart } from '../api/get-live-chart.api';
import { LIVE_QUERY_STALE_MS, liveKeys } from '../query-keys';

/** Hourly cumulative-profit series (today + yesterday). Disabled until org + store resolve. */
export function useLiveChart(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<LivePerformanceChart> {
  const enabled = orgId !== null && storeId !== null;
  return useQuery<LivePerformanceChart>({
    queryKey: enabled ? liveKeys.chart(orgId, storeId) : [...liveKeys.all, 'chart', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null)
        throw new Error('useLiveChart called without org/store');
      return getLiveChart({ orgId, storeId });
    },
    enabled,
    staleTime: LIVE_QUERY_STALE_MS,
  });
}
