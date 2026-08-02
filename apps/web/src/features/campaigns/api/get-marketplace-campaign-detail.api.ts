import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type CampaignDiscountType = components['schemas']['CampaignDiscountType'];
export type CampaignValueKind = components['schemas']['CampaignValueKind'];
export type CampaignPriceSelection = components['schemas']['CampaignPriceSelection'];
export type CampaignCommissionSource = components['schemas']['CampaignCommissionSource'];
export type CampaignCommissionBand = components['schemas']['CampaignCommissionBand'];
export type CampaignItemReason = components['schemas']['CampaignItemReason'];
export type CampaignBasketScenario = components['schemas']['CampaignBasketScenario'];
export type CampaignScenario = components['schemas']['CampaignScenario'];
export type CampaignScenarioPresentation = components['schemas']['CampaignScenarioPresentation'];

// `customScenario` is a NULLABLE $ref (CampaignScenario | null). zod-openapi emits that as
// `allOf: [$ref, {type:[object,null]}]`, which openapi-typescript renders as
// `CampaignScenario & (Record<string, never> | null)` — a known nullable-$ref quirk (see
// `estimate-discount-item.api.ts`) that makes every scenario field `never`. Narrow it back to
// the true runtime shape here (type-only; the wire value is unchanged, and the raw shape is
// still structurally assignable to the narrowed one: `never` is assignable to any field type).
type RawMarketplaceCampaignDetailItem = components['schemas']['MarketplaceCampaignDetailItem'];
export type MarketplaceCampaignDetailItem = Omit<
  RawMarketplaceCampaignDetailItem,
  'customScenario'
> & {
  customScenario: CampaignScenario | null;
};

type RawMarketplaceCampaignDetail = components['schemas']['MarketplaceCampaignDetail'];
export type MarketplaceCampaignDetail = Omit<RawMarketplaceCampaignDetail, 'items'> & {
  items: MarketplaceCampaignDetailItem[];
};

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}
 *
 * Returns one saved campaign with its configuration (including the Trendyol funding rate),
 * which commission tariff period fed the bands, and every item with THREE price scenarios —
 * `current` (not participating), `maxScenario` (the maximum price Trendyol allows), and
 * `customScenario` (the seller's own saved price, null when none is saved). Basket-scoped
 * discount types additionally carry a single-product-basket settlement `scenario`, framed on
 * the item's SAVED price choice. Profit is computed on read by the profit engine and never
 * stored. Money fields are GROSS decimal strings — the frontend renders, never computes.
 * Uncalculable rows carry `calculable:false`, a `reason`, and null profit/margin on every
 * scenario.
 */
export async function getMarketplaceCampaignDetail(
  orgId: string,
  storeId: string,
  campaignId: string,
): Promise<MarketplaceCampaignDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}',
    { params: { path: { orgId, storeId, campaignId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
