import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

/**
 * DELETE /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}
 *
 * Hard-deletes a tariff (its periods + items cascade). Returns 204 (no body).
 */
export async function deleteTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<void> {
  const { error, response } = await apiClient.DELETE(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}',
    { params: { path: { orgId, storeId, tariffId } } },
  );
  if (error !== undefined) throwApiError(error, response);
}
