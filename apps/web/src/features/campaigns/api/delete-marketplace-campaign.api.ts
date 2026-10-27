import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

/**
 * DELETE /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}
 *
 * Hard-deletes a marketplace campaign (its items cascade). Returns 204 (no body). A campaign
 * id from another store returns 404, indistinguishable from a missing one.
 */
export async function deleteMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
): Promise<void> {
  const { error, response } = await apiClient.DELETE(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}',
    { params: { path: { orgId, storeId, campaignId } } },
  );
  if (error !== undefined) throwApiError(error, response);
}
