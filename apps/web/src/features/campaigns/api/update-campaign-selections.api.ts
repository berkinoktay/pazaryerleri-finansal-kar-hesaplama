import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateCampaignSelectionsBody = components['schemas']['UpdateCampaignSelectionsBody'];
export type UpdateCampaignSelectionsResponse =
  components['schemas']['UpdateCampaignSelectionsResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/selections
 *
 * Persists the seller's per-item campaign price choice. `mode: 'set'` writes the given rows
 * one by one (each `{ itemId, selection, customPrice }`); `mode: 'all'` applies the MAX price
 * option and `'none'` clears participation across the WHOLE campaign in a single statement (so
 * a 500-row campaign is one request). `customPrice` is stored independently of `selection`, so
 * a seller can keep a typed price while participating at the maximum — `'all'`/`'none'` never
 * discard it. A custom price above the item's maximum comes back as a 422
 * CUSTOM_PRICE_ABOVE_MAX. Items not belonging to this campaign/store are ignored. Returns how
 * many items were updated.
 */
export async function updateCampaignSelections(
  orgId: string,
  storeId: string,
  campaignId: string,
  body: UpdateCampaignSelectionsBody,
): Promise<UpdateCampaignSelectionsResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/selections',
    { params: { path: { orgId, storeId, campaignId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
