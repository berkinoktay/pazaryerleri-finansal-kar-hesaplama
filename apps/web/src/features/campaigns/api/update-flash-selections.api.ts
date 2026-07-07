import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateFlashSelectionsBody = components['schemas']['UpdateFlashSelectionsBody'];
export type UpdateFlashSelectionsResponse = components['schemas']['UpdateFlashSelectionsResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/selections
 *
 * Persists the seller's per-item flash-offer choice (`offer`: 'H24' | 'H3' | null) plus
 * an optional custom price, in one bulk update. An offer and a custom price are mutually
 * exclusive per item (the client enforces the XOR — a custom row sends `offer: null` with
 * its price, an offer row sends the offer with `customPrice: null`). Selection runs
 * client-side over the backend-computed margins; this only records the result. Returns
 * the updated count.
 */
export async function updateFlashSelections(
  orgId: string,
  storeId: string,
  listId: string,
  body: UpdateFlashSelectionsBody,
): Promise<UpdateFlashSelectionsResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/selections',
    { params: { path: { orgId, storeId, listId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
