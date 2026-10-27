import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type EstimateCampaignItemBody = components['schemas']['EstimateCampaignItemBody'];
export type QuoteBreakdown = components['schemas']['QuoteBreakdown'];

// The backend serializes `breakdown` as a NULLABLE $ref (QuoteBreakdown | null).
// zod-openapi emits that as `allOf: [$ref, {type:[object,null]}]`, which
// openapi-typescript renders as `QuoteBreakdown & (Record<string, never> | null)` —
// a known nullable-$ref quirk (see `estimate-discount-item.api.ts`) that makes every
// breakdown field `never`. Narrow it back to the true runtime shape here (type-only; the
// wire value is unchanged).
type RawEstimateCampaignItemResult = components['schemas']['EstimateCampaignItemResult'];
export type EstimateCampaignItemResult = Omit<RawEstimateCampaignItemResult, 'breakdown'> & {
  breakdown: QuoteBreakdown | null;
};

/**
 * POST /v1/.../marketplace-campaigns/{campaignId}/items/{itemId}/estimate
 *
 * Full profit breakdown for one campaign item under the chosen scenario (POST-only because it
 * carries a body; read-only, no state changes):
 *   1. `scenario: 'current'` — price the item campaign-free at its current price.
 *   2. `scenario: 'max'` — price it at the maximum Trendyol allows.
 *   3. `scenario: 'custom'` — price it at the seller's own price (from the body when given —
 *      the screen buffers an unsaved edit — else from the stored `customPrice`).
 * `price` is what the SELLER earns. At unit scope, `customerPaidUnitPrice` and
 * `trendyolFundedUnitAmount` split one unit into what the customer pays and what Trendyol
 * funds; BOTH ARE NULL for the campaign-free `current` scenario AND whenever
 * `breakdownScope` is `"order"` — the `max` / `custom` scenarios of an order-presentation
 * campaign (BUY_X_PAY_Y / NTH_PRODUCT / a conditional-AMOUNT discount) report the split as
 * basket totals on the result's `basket` instead (the same block as the row's `maxBasket` /
 * `customBasket` for that price), because a per-unit average describes no real unit there.
 * Do not derive a fallback value for these fields when they are null — null is the correct,
 * final answer at order scope. `current` is always a unit-scope breakdown.
 *
 * A custom price above the item's maximum is refused with 422 CUSTOM_PRICE_ABOVE_MAX, and a
 * custom scenario with no price anywhere with 422 CUSTOM_PRICE_REQUIRED — both flow through
 * the global onError pipeline, so no custom onError here.
 */
export async function estimateCampaignItem(
  orgId: string,
  storeId: string,
  campaignId: string,
  itemId: string,
  body: EstimateCampaignItemBody,
): Promise<EstimateCampaignItemResult> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/items/{itemId}/estimate',
    { params: { path: { orgId, storeId, campaignId, itemId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
