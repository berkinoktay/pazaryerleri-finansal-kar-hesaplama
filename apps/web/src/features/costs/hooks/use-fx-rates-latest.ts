'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getFxRatesLatest, type FxRatesLatestResponse } from '../api/get-fx-rates-latest.api';

import { costsKeys } from './costs-keys';

/**
 * Provides the latest TCMB FX rates for form UI previews.
 * Data is stale-for-1-hour since rates update once daily via cron.
 *
 * Disabled when orgId is null (e.g. before the active-org cookie resolves).
 */
export function useFxRatesLatest(orgId: string | null): UseQueryResult<FxRatesLatestResponse> {
  return useQuery<FxRatesLatestResponse>({
    queryKey:
      orgId !== null
        ? costsKeys.fxRatesLatest(orgId)
        : ['costs', 'fx-rates', 'latest', '__disabled__'],
    queryFn: () => {
      if (orgId === null) throw new Error('useFxRatesLatest called without orgId');
      return getFxRatesLatest(orgId);
    },
    enabled: orgId !== null,
    // FX rates update once per business day — 1-hour stale time avoids
    // unnecessary refetches while keeping the preview reasonably fresh.
    staleTime: 60 * 60 * 1000,
  });
}
