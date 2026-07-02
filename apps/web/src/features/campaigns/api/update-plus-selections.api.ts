import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdatePlusSelectionsBody = components['schemas']['UpdatePlusSelectionsBody'];
export type UpdatePlusSelectionsResponse = components['schemas']['UpdatePlusSelectionsResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections
 *
 * Persists the seller's Plus opt-in (`selected` boolean) plus an optional custom
 * price per item, in one bulk update. Selection runs client-side over the
 * backend-computed margins; this only records the result. Returns the updated count.
 */
export async function updatePlusSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
  body: UpdatePlusSelectionsBody,
): Promise<UpdatePlusSelectionsResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections',
    { params: { path: { orgId, storeId, tariffId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
