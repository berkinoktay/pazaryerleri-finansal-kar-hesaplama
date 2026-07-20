import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateDiscountSelectionsBody = components['schemas']['UpdateDiscountSelectionsBody'];
export type UpdateDiscountSelectionsResponse =
  components['schemas']['UpdateDiscountSelectionsResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/selections
 *
 * Persists the seller's per-item participation choice. `mode: 'set'` updates the given rows
 * one by one (each `{ itemId, included }`); `mode: 'all'` includes and `'none'` excludes the
 * WHOLE list in a single statement (so a 500-row list is one request). Items not belonging to
 * this list/store are ignored. Selection runs client-side over the backend-computed scenarios;
 * this only records the result. Returns the updated count.
 */
export async function updateDiscountSelections(
  orgId: string,
  storeId: string,
  listId: string,
  body: UpdateDiscountSelectionsBody,
): Promise<UpdateDiscountSelectionsResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/selections',
    { params: { path: { orgId, storeId, listId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
