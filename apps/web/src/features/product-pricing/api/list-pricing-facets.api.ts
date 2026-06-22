import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type PricingFacetsResponse = components['schemas']['ProductFacetsResponse'];

/**
 * Brand + category option lists for the pricing filter toolbar. Reuses the
 * store-scoped products `/facets` endpoint — the same approved-variant
 * universe the pricing list draws from, so its brand/category facets line up
 * 1:1 with the `categoryId` / `brandId` filters. Feature-local (not imported
 * from features/products) to respect the feature boundary; the shared contract
 * is the generated `ProductFacetsResponse` schema.
 */
export async function listPricingFacets(
  orgId: string,
  storeId: string,
): Promise<PricingFacetsResponse> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/products/facets',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
