import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type EstimateDiscountItemBody = components['schemas']['EstimateDiscountItemBody'];
export type QuoteBreakdown = components['schemas']['QuoteBreakdown'];

// The backend serializes `breakdown` as a NULLABLE $ref (QuoteBreakdown | null).
// zod-openapi emits that as `allOf: [$ref, {type:[object,null]}]`, which
// openapi-typescript renders as `QuoteBreakdown & (Record<string, never> | null)` —
// a known nullable-$ref quirk that makes every breakdown field `never`. Narrow it
// back to the true runtime shape here (type-only; the wire value is unchanged).
type RawEstimateDiscountItemResult = components['schemas']['EstimateDiscountItemResult'];
export type EstimateDiscountItemResult = Omit<RawEstimateDiscountItemResult, 'breakdown'> & {
  breakdown: QuoteBreakdown | null;
};

/**
 * POST /v1/.../discount-lists/{listId}/items/{itemId}/estimate
 *
 * Full profit breakdown for one discount item under the chosen scenario (POST-only because it
 * carries a body; read-only, no state changes):
 *   1. `scenario: 'current'` — price the item at its current price.
 *   2. `scenario: 'discounted'` — price it at the list discount applied to that price.
 * Either way the reduced commission is RE-resolved on the scenario price (a lower price can
 * land in a different commission band), so the modal never disagrees with the detail row.
 *
 * A `calculable:false` response is a normal 200 (not an error): the item is unmatched,
 * uncostable, or has no resolvable commission, and `breakdown` is null. Callers MUST check
 * `result.calculable` before reading `result.breakdown`. Real errors flow through the global
 * onError pipeline, so no custom onError here.
 */
export async function estimateDiscountItem(
  orgId: string,
  storeId: string,
  listId: string,
  itemId: string,
  body: EstimateDiscountItemBody,
): Promise<EstimateDiscountItemResult> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/items/{itemId}/estimate',
    { params: { path: { orgId, storeId, listId, itemId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
