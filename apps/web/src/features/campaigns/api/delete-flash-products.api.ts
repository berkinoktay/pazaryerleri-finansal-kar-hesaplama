import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

/**
 * DELETE /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}
 *
 * Hard-deletes a Flash Products list (its offer rows cascade). Returns 204 (no body).
 */
export async function deleteFlashProducts(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<void> {
  const { error, response } = await apiClient.DELETE(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}',
    { params: { path: { orgId, storeId, listId } } },
  );
  if (error !== undefined) throwApiError(error, response);
}
