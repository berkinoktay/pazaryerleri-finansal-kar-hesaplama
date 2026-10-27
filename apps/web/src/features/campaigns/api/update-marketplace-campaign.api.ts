import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateMarketplaceCampaignBody = components['schemas']['UpdateMarketplaceCampaignBody'];
export type UpdateMarketplaceCampaignResponse =
  components['schemas']['UpdateMarketplaceCampaignResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}
 *
 * FULL-REPLACES the campaign configuration (discount type + its per-type parameters, the
 * Trendyol funding rate and the campaign window); the display name changes only when
 * provided. Send the WHOLE configuration on every call: an omitted field is RESET, not
 * preserved — `trendyolFundingPct` in particular has no client-side default, so it must
 * always be sent explicitly. The same config validator that gates the import upload gates
 * this body, so a combination Trendyol wouldn't accept (e.g. a fixed price on a non-Nth
 * campaign, or a funding rate above 100) is a 422 VALIDATION_ERROR surfaced inline. Items are
 * untouched — but every item's scenario is recomputed on the next detail read, so the caller
 * invalidates the detail.
 */
export async function updateMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
  body: UpdateMarketplaceCampaignBody,
): Promise<UpdateMarketplaceCampaignResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}',
    { params: { path: { orgId, storeId, campaignId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
