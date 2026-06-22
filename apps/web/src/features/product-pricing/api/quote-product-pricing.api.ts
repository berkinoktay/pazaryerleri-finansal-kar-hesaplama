import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type QuoteInput = components['schemas']['QuoteInput'];
export type ProductPriceQuote = components['schemas']['ProductPriceQuote'];
export type QuoteBreakdown = components['schemas']['QuoteBreakdown'];

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/product-pricing/quote
 *
 * Reverse-solver: given a target (margin %, markup %, or absolute profit),
 * returns the sale price that achieves it — along with a full breakdown.
 *
 * A `calculable:false` response is a normal 200 (not an error). Callers MUST
 * check `result.calculable` before accessing `result.price` / `result.breakdown`.
 */
export async function quoteProductPricing(
  orgId: string,
  storeId: string,
  body: QuoteInput,
): Promise<ProductPriceQuote> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/product-pricing/quote',
    { params: { path: { orgId, storeId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
