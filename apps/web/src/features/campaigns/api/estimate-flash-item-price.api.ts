import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type EstimateFlashPriceBody = components['schemas']['EstimateFlashPriceBody'];
export type QuoteBreakdown = components['schemas']['QuoteBreakdown'];

// The backend serializes `breakdown` as a NULLABLE $ref (QuoteBreakdown | null).
// zod-openapi emits that as `allOf: [$ref, {type:[object,null]}]`, which
// openapi-typescript renders as `QuoteBreakdown & (Record<string, never> | null)` —
// a known nullable-$ref quirk that makes every breakdown field `never`. Narrow it
// back to the true runtime shape here (type-only; the wire value is unchanged).
type RawEstimateFlashPriceResult = components['schemas']['EstimateFlashPriceResult'];
export type EstimateFlashPriceResult = Omit<RawEstimateFlashPriceResult, 'breakdown'> & {
  breakdown: QuoteBreakdown | null;
};

/**
 * POST /v1/.../flash-products/{listId}/items/{itemId}/estimate
 *
 * Full profit breakdown for one Flash Products item, in one of two mutually exclusive
 * modes (POST-only because it carries a body; read-only):
 *   1. Custom-price what-if — pass `price`; the reduced commission is resolved from the
 *      band that price lands in (of the item's primary window) or the flat fallback.
 *   2. Current scenario — pass `scenario: 'current'` and no price; the item's own
 *      customer price + its current commission drive the breakdown, so it matches the
 *      row's `currentNetProfit` badge byte-for-byte.
 *
 * A `calculable:false` response is a normal 200 (not an error): the item is unmatched,
 * uncostable, or its shipping cannot be resolved, and `breakdown` is null. Callers MUST
 * check `result.calculable` before reading `result.breakdown`. Real errors flow through
 * the global onError pipeline, so no custom onError here.
 */
export async function estimateFlashItemPrice(
  orgId: string,
  storeId: string,
  listId: string,
  itemId: string,
  body: EstimateFlashPriceBody,
): Promise<EstimateFlashPriceResult> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/items/{itemId}/estimate',
    { params: { path: { orgId, storeId, listId, itemId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
