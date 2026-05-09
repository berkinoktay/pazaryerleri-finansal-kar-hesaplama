'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getFxRatesLatest, type FxRatesLatestResponse } from '../api/get-fx-rates-latest.api';

import { costsKeys } from './costs-keys';

/**
 * Provides the latest TCMB FX rates for form UI previews.
 * Data is stale-for-1-hour since rates update once daily via cron.
 *
 * NOTE: Returns null data until PR 6 lands the /fx-rates/latest endpoint.
 */
export function useFxRatesLatest(): UseQueryResult<FxRatesLatestResponse> {
  return useQuery<FxRatesLatestResponse>({
    queryKey: costsKeys.fxRatesLatest(),
    queryFn: getFxRatesLatest,
    // FX rates update once per business day — 1-hour stale time avoids
    // unnecessary refetches while keeping the preview reasonably fresh.
    staleTime: 60 * 60 * 1000,
  });
}
