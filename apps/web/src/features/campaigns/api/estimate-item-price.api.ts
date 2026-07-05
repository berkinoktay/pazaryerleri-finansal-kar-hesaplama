import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type EstimateItemPriceBody = components['schemas']['EstimateItemPriceBody'];
export type QuoteBreakdown = components['schemas']['QuoteBreakdown'];

// The backend serializes `breakdown` as a NULLABLE $ref (QuoteBreakdown | null).
// zod-openapi emits that as `allOf: [$ref, {type:[object,null]}]`, which
// openapi-typescript renders as `QuoteBreakdown & Record<string, never>` — a
// known nullable-$ref quirk that makes every breakdown field `never`. Narrow it
// back to the true runtime shape here (type-only; the wire value is unchanged).
type RawEstimateItemPriceResult = components['schemas']['EstimateItemPriceResult'];
export type EstimateItemPriceResult = Omit<RawEstimateItemPriceResult, 'breakdown'> & {
  breakdown: QuoteBreakdown | null;
};

/**
 * POST /v1/.../commission-tariffs/{tariffId}/items/{itemId}/estimate
 *
 * Full profit breakdown for one tariff item. Three modes:
 * - Band click — pass `price` plus `bandKey`; that band's commission is applied
 *   verbatim (the band-click breakdown modal).
 * - Custom-price what-if — pass only `price`; the applicable band is derived from it.
 * - Current scenario — pass `scenario: 'current'` (no price/bandKey); the item's own
 *   commission-base price (or its sale price when absent) + current commission are used.
 *
 * A `calculable:false` response is a normal 200 (not an error): the item is
 * unmatched or uncostable and `breakdown` is null. Callers MUST check
 * `result.calculable` before reading `result.breakdown`.
 */
export async function estimateItemPrice(
  orgId: string,
  storeId: string,
  tariffId: string,
  itemId: string,
  body: EstimateItemPriceBody,
): Promise<EstimateItemPriceResult> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/items/{itemId}/estimate',
    { params: { path: { orgId, storeId, tariffId, itemId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
