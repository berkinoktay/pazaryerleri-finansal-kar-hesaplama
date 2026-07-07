import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type FlashProductListItem = components['schemas']['FlashProductListItem'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/flash-products
 *
 * Lists the store's saved Flash Products uploads (newest first) with the master-list
 * aggregates: distinct product count, item (offer row) count, how many rows already
 * have a chosen offer or custom price (`selectedCount`), the exported flag, and the
 * last-updated timestamp. Like the Advantage list there is NO validity axis on the LIST
 * screen — the only status dimension is upload/export state (the per-offer window
 * validity lives on the detail rows).
 */
export async function listFlashProducts(
  orgId: string,
  storeId: string,
): Promise<FlashProductListItem[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
