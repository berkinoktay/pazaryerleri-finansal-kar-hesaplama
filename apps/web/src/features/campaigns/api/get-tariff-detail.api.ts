import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type CommissionTariffDetail = components['schemas']['CommissionTariffDetail'];
export type TariffPeriod = components['schemas']['TariffPeriod'];
export type TariffDetailItem = components['schemas']['TariffDetailItem'];
export type TariffBandResult = components['schemas']['TariffBandResult'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}
 *
 * Returns one tariff with its periods and, per product row, the four price bands
 * with net profit + margin COMPUTED on read by the backend engine. Money fields
 * are GROSS decimal strings — the frontend renders, never computes.
 */
export async function getTariffDetail(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<CommissionTariffDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}',
    { params: { path: { orgId, storeId, tariffId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
