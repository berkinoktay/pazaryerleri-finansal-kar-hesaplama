import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

/**
 * DELETE /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}
 *
 * Hard-deletes a discount list (its items cascade). Returns 204 (no body). A list id from
 * another store returns 404, indistinguishable from a missing one.
 */
export async function deleteDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<void> {
  const { error, response } = await apiClient.DELETE(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}',
    { params: { path: { orgId, storeId, listId } } },
  );
  if (error !== undefined) throwApiError(error, response);
}
