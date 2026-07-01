import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type CommissionTariffListItem = components['schemas']['CommissionTariffListItem'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs
 *
 * Lists the store's saved commission-tariff uploads (newest first) with the
 * master-list aggregates: product/selection counts, exported flag, validity.
 */
export async function listTariffs(
  orgId: string,
  storeId: string,
): Promise<CommissionTariffListItem[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
