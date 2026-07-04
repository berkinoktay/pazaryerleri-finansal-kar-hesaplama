import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type AdvantageTariffDetail = components['schemas']['AdvantageTariffDetail'];
export type AdvantageTariffDetailItem = components['schemas']['AdvantageTariffDetailItem'];
export type AdvantageTier = components['schemas']['AdvantageTier'];
export type AdvantageCurrentScenario = components['schemas']['AdvantageCurrentScenario'];
export type AdvantageCommissionSource = components['schemas']['AdvantageCommissionSource'];
export type CommissionSourceMode = components['schemas']['CommissionSourceMode'];
export type CommissionSourceKind = components['schemas']['CommissionSourceKind'];
export type StarTierKey = components['schemas']['StarTierKey'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}
 *
 * Returns one Advantage tariff with its product rows (no periods — an Advantage file
 * carries no dates). Each row carries the `current` baseline scenario plus a `tiers`
 * array (Avantaj / Çok Avantaj / Süper Avantaj) with the target price, reduced
 * commission, net profit + margin COMPUTED on read by the backend engine, and the
 * `bestTierKey`. The detail also surfaces WHICH commission tariff/period supplied the
 * rates (`commissionSource` + `commissionSourceMode`) and whether any H="Var" product
 * failed to match a commission tariff (`hasUnmatchedCommissionProducts`). Money fields
 * are GROSS decimal strings — the frontend renders, never computes. Uncalculable rows
 * carry null profit/margin.
 */
export async function getAdvantageTariffDetail(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<AdvantageTariffDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}',
    { params: { path: { orgId, storeId, tariffId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
