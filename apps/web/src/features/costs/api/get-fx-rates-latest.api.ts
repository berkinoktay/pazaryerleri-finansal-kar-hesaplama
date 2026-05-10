/**
 * Fetches the latest TCMB FX rates (USD/TRY and EUR/TRY) for the given org.
 *
 * Backed by GET /v1/organizations/{orgId}/fx-rates/latest. Rates are global
 * (the org scope is a routing convention; data is not partitioned by org).
 * A null entry for either currency means TCMB cron has not yet populated
 * that rate — UI shows a fallback "loading" placeholder in that case.
 */

import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type FxRateEntry = components['schemas']['FxRateEntry'];
export type FxRatesLatestResponse = components['schemas']['FxRatesLatestResponse'];

export async function getFxRatesLatest(orgId: string): Promise<FxRatesLatestResponse> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/fx-rates/latest',
    { params: { path: { orgId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
