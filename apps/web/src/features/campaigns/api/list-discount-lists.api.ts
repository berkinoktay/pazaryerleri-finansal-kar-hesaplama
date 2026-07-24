import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type DiscountListListItem = components['schemas']['DiscountListListItem'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists
 *
 * Lists the store's saved discount lists (İndirimler, newest first) with the master-list
 * aggregates: its discount configuration (type + per-type parameters), the item count, how
 * many rows are already included (`selectedCount`), the exported flag, and the last-updated
 * timestamp. Like the Flash list there is NO validity axis on the LIST screen — the only
 * status dimension is upload/export state. Money fields are GROSS decimal strings.
 */
export async function listDiscountLists(
  orgId: string,
  storeId: string,
): Promise<DiscountListListItem[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
