import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateSelectionsBody = components['schemas']['UpdateSelectionsBody'];
export type UpdateSelectionsResponse = components['schemas']['UpdateSelectionsResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections
 *
 * Persists the seller's band choice (`band1`..`band4`, or null to clear) plus an
 * optional custom price per item, in one bulk update. Selection runs client-side
 * over the backend-computed margins; this only records the result.
 */
export async function updateSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
  body: UpdateSelectionsBody,
): Promise<UpdateSelectionsResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections',
    { params: { path: { orgId, storeId, tariffId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
