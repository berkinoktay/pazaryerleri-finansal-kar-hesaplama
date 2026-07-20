import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateDiscountListBody = components['schemas']['UpdateDiscountListBody'];
export type UpdateDiscountListResponse = components['schemas']['UpdateDiscountListResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}
 *
 * Full-replaces the discount configuration on the list row (discount type + its per-type
 * parameters, campaign window, order limit); the display name changes only when provided.
 * The same config validator that gates the import upload gates this body, so a combination
 * Trendyol wouldn't accept (e.g. a fixed price on a non-Nth discount) is a 422
 * VALIDATION_ERROR surfaced inline. Items are untouched — but every item's discounted
 * scenario is recomputed on the next detail read, so the caller invalidates the detail.
 */
export async function updateDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
  body: UpdateDiscountListBody,
): Promise<UpdateDiscountListResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}',
    { params: { path: { orgId, storeId, listId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
