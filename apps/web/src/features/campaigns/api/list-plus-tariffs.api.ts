import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type PlusTariffListItem = components['schemas']['PlusTariffListItem'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs
 *
 * Lists the store's saved Plus commission-tariff uploads (newest first) with the
 * master-list aggregates: product count, how many products are opted in to Plus
 * (`selectedCount`), the exported flag, validity, and last-updated timestamp.
 */
export async function listPlusTariffs(
  orgId: string,
  storeId: string,
): Promise<PlusTariffListItem[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
