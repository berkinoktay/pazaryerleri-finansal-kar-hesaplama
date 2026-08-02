import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type MarketplaceCampaignListItem = components['schemas']['MarketplaceCampaignListItem'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns
 *
 * Lists the store's saved marketplace campaigns (Kampanyalar, newest first) with each
 * campaign's configuration (discount type + per-type parameters), Trendyol's funding rate,
 * the item count, how many items already carry a price choice (`selectedCount`), the
 * exported flag, and the last-updated timestamp. Money fields are GROSS decimal strings.
 */
export async function listMarketplaceCampaigns(
  orgId: string,
  storeId: string,
): Promise<MarketplaceCampaignListItem[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
