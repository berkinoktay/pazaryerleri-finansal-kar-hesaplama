import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateAdvantageSelectionsBody = components['schemas']['UpdateAdvantageSelectionsBody'];
export type UpdateAdvantageSelectionsResponse =
  components['schemas']['UpdateAdvantageSelectionsResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/selections
 *
 * Persists the seller's per-product star-tier choice (`tier`: tier1 | tier2 | tier3 |
 * null) plus an optional custom price, in one bulk update. Selection runs client-side
 * over the backend-computed margins; this only records the result. Returns the updated
 * count.
 */
export async function updateAdvantageSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
  body: UpdateAdvantageSelectionsBody,
): Promise<UpdateAdvantageSelectionsResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/selections',
    { params: { path: { orgId, storeId, tariffId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
