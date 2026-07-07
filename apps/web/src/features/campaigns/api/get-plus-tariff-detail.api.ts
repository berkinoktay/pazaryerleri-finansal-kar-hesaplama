import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type PlusTariffDetail = components['schemas']['PlusTariffDetail'];
export type PlusTariffPeriod = components['schemas']['PlusTariffPeriod'];
export type PlusTariffDetailItem = components['schemas']['PlusTariffDetailItem'];
export type PlusScenario = components['schemas']['PlusScenario'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}
 *
 * Returns one Plus tariff with its periods (one 7-day window, or a split week) and,
 * per product row, the flat `current` figures (`currentPrice`/`commissionBasePrice`/
 * `currentCommissionPct`/`currentNetProfit`/`currentMarginPct`) plus the single `plus`
 * offer scenario (ceiling price + reduced commission + net profit + margin) and
 * `plusIsBetter`, COMPUTED on read by the backend engine. Money fields are GROSS
 * decimal strings — the frontend renders, never computes. Uncalculable rows carry
 * null profit/margin.
 */
export async function getPlusTariffDetail(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<PlusTariffDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}',
    { params: { path: { orgId, storeId, tariffId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
