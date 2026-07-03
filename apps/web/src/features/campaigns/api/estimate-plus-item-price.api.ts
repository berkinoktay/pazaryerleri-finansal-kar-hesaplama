import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type EstimatePlusPriceBody = components['schemas']['EstimatePlusPriceBody'];
export type QuoteBreakdown = components['schemas']['QuoteBreakdown'];

// The backend serializes `breakdown` as a NULLABLE $ref (QuoteBreakdown | null).
// zod-openapi emits that as `allOf: [$ref, {type:[object,null]}]`, which
// openapi-typescript renders as `QuoteBreakdown & (Record<string, never> | null)` —
// a known nullable-$ref quirk that makes every breakdown field `never`. Narrow it
// back to the true runtime shape here (type-only; the wire value is unchanged).
type RawEstimatePlusPriceResult = components['schemas']['EstimatePlusPriceResult'];
export type EstimatePlusPriceResult = Omit<RawEstimatePlusPriceResult, 'breakdown'> & {
  breakdown: QuoteBreakdown | null;
};

/**
 * POST /v1/.../plus-commission-tariffs/{tariffId}/items/{itemId}/estimate
 *
 * Full profit breakdown for one Plus tariff item at a given price, using the item's
 * reduced Plus commission. Unlike the commission estimate there is no band — the
 * price alone drives the what-if (POST-only because it carries a body; read-only).
 *
 * A `calculable:false` response is a normal 200 (not an error): the item is
 * unmatched or uncostable and `breakdown` is null. Callers MUST check
 * `result.calculable` before reading `result.breakdown`. Real errors flow through
 * the global onError pipeline, so no custom onError here.
 */
export async function estimatePlusItemPrice(
  orgId: string,
  storeId: string,
  tariffId: string,
  itemId: string,
  body: EstimatePlusPriceBody,
): Promise<EstimatePlusPriceResult> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/items/{itemId}/estimate',
    { params: { path: { orgId, storeId, tariffId, itemId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
