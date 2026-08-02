import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type TargetMarginBody = components['schemas']['TargetMarginBody'];
export type TargetMarginResult = components['schemas']['TargetMarginResult'];

/**
 * POST /v1/.../marketplace-campaigns/{campaignId}/target-margin
 *
 * For every item in the campaign, computes the SMALLEST campaign price whose net margin
 * reaches `targetMarginPct`, capped at the item's maximum price. The commission is anchored
 * on the maximum price's band, so a suggestion landing in a cheaper band is optimistic — the
 * row's own scenario shows the real figure. An item whose target no price reaches comes back
 * with reason `UNREACHABLE`; one missing cost/shipping/commission input with
 * `NOT_CALCULABLE`. Suggestions arrive in the campaign's own row order.
 *
 * This endpoint COMPUTES AND RETURNS — it writes NOTHING. The caller puts the suggested
 * prices into its local edit buffer; they become persistent only when the seller saves
 * through `updateCampaignSelections`. Read-only (POST only because it carries a body).
 */
export async function suggestTargetMargin(
  orgId: string,
  storeId: string,
  campaignId: string,
  body: TargetMarginBody,
): Promise<TargetMarginResult> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/target-margin',
    { params: { path: { orgId, storeId, campaignId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
