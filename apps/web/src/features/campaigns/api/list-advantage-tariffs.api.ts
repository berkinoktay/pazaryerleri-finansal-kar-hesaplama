import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type AdvantageTariffListItem = components['schemas']['AdvantageTariffListItem'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs
 *
 * Lists the store's saved Advantage product-label uploads (newest first) with the
 * master-list aggregates: product count, how many products already have a chosen
 * star tier (`selectedCount`), the exported flag, and last-updated timestamp.
 * Unlike the commission/Plus lists there is NO validity — Advantage files carry no
 * dates — so the only status axis is upload/export state.
 */
export async function listAdvantageTariffs(
  orgId: string,
  storeId: string,
): Promise<AdvantageTariffListItem[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
