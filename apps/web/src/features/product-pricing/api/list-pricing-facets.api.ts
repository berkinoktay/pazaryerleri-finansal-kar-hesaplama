import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type PricingFacetsResponse = components['schemas']['ProductFacetsResponse'];

/**
 * Brand + category option lists for the pricing filter toolbar. Reuses the
 * store-scoped products `/facets` endpoint, whose brand/category counts only
 * include products with at least one variant in the default listing scope
 * (still in Trendyol's feed, not ARCHIVED). The pricing list also returns
 * archived and delisted variants, so a brand or category whose products are
 * all archived or delisted has rows in the pricing table but no option here.
 * That gap is accepted until the pricing list adopts the same scope.
 * Feature-local (not imported from features/products) to respect the feature
 * boundary; the shared contract is the generated `ProductFacetsResponse` schema.
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
