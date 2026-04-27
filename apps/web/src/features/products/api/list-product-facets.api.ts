import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type ProductFacetsResponse = components['schemas']['ProductFacetsResponse'];

export async function listProductFacets(
  orgId: string,
  storeId: string,
): Promise<ProductFacetsResponse> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/products/facets',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
