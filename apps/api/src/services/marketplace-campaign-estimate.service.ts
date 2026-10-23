// On-demand profit estimate + target-margin price suggestion for Kampanyalar
// (Trendyol-designed campaign participation).
//
// Two read-only entry points, both scoped by organizationId + storeId + campaign:
//
//   estimateCampaignItem        → the breakdown modal's data for ONE item under ONE of the
//                                 three scenarios (current / max / custom).
//   suggestCampaignTargetMargin → a suggested campaign price per item for a target margin.
//
// NEITHER WRITES ANYTHING. The seller's price choices live in an ephemeral client buffer
// until "Kaydet ve İndir" posts them to the selections endpoint; persisting a suggestion
// here would create a second source of truth for the same state (design §6).
//
// This file resolves NOTHING and computes NOTHING on its own: the priced inputs come from the
// shared `resolveCampaignEconomics` (the same one the detail view uses) and every number comes
// from the shared compute. Both halves of "the modal must not disagree with the row" — the
// inputs and the math — therefore have exactly one implementation each.
//
// A cross-tenant or foreign campaign/item id is indistinguishable from a missing one (404).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError, ValidationError } from '../lib/errors';
import {
  effectiveUnitPrice,
  sellerEffectivePrice,
  type DiscountConfig,
} from './discount-math-commons';
import {
  computeCampaignEstimate,
  suggestTargetMarginPrices,
  type CampaignTargetMarginItem,
} from './marketplace-campaign-compute.service';
import { resolveCampaignEconomics, EMPTY_ITEM_ECONOMICS } from './marketplace-campaign-economics';
import {
  campaignConfigFromListRow,
  type EstimateCampaignItemBody,
  type EstimateCampaignItemResult,
  type TargetMarginResult,
} from '../validators/marketplace-campaign.validator';

/** The campaign columns both entry points read to rebuild the config + funding rate. */
const CAMPAIGN_CONFIG_SELECT = {
  discountType: true,
  valueKind: true,
  value: true,
  minBasketAmount: true,
  minQuantity: true,
  buyQuantity: true,
  payQuantity: true,
  nthIndex: true,
  trendyolFundingPct: true,
  startsAt: true,
} as const;

// ─── Single-item estimate (breakdown modal) ───────────────────────────────────

/** The campaign price a scenario is priced at, and whether the promotion applies to it. */
interface ScenarioPrice {
  readonly price: Decimal;
  readonly applyCampaign: boolean;
}

/**
 * Picks the campaign price for the requested scenario.
 *
 * `custom` prefers the price in the REQUEST body over the persisted one: the seller types in
 * an ephemeral client buffer and opens the modal before saving, so the modal must price what
 * is on screen. The ceiling is enforced here because the modal is where a seller discovers a
 * price — refusing it at save time only, after they had already read a profit for it, would
 * be the later and more confusing failure.
 */
function resolveScenarioPrice(
  body: EstimateCampaignItemBody,
  currentPrice: Decimal,
  maxPrice: Decimal,
  savedCustomPrice: Decimal | null,
): ScenarioPrice {
  switch (body.scenario) {
    case 'current':
      return { price: currentPrice, applyCampaign: false };
    case 'max':
      return { price: maxPrice, applyCampaign: true };
    case 'custom': {
      const requested =
        body.customPrice !== undefined ? new Decimal(body.customPrice) : savedCustomPrice;
      if (requested === null) {
        throw new ValidationError([{ field: 'customPrice', code: 'CUSTOM_PRICE_REQUIRED' }]);
      }
      if (requested.gt(maxPrice)) {
        throw new ValidationError([
          {
            field: 'customPrice',
            code: 'CUSTOM_PRICE_ABOVE_MAX',
            meta: { maxPrice: maxPrice.toFixed(2) },
          },
        ]);
      }
      return { price: requested, applyCampaign: true };
    }
    default: {
      const _exhaustive: never = body.scenario;
      throw new Error(`Unhandled campaign estimate scenario: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Full profit breakdown for ONE campaign item under one scenario. Throws `NotFoundError`
 * when the item does not belong to this campaign/store.
 *
 * Both the framing and the math live in `computeCampaignEstimate`; this function's only job is
 * to decide WHICH campaign price the scenario carries (current / max / custom) and to hand over
 * the item's current price, which prices the same basket campaign-free. An order-scoped result
 * frames its basket on the scenario's OWN price — the same block the row's price card shows —
 * and the campaign-free `current` scenario is always a single-unit breakdown.
 */
export async function estimateCampaignItem(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  campaignId: string,
  itemId: string,
  body: EstimateCampaignItemBody,
): Promise<EstimateCampaignItemResult> {
  let item;
  try {
    item = await prisma.marketplaceCampaignItem.findFirst({
      where: { id: itemId, organizationId: orgId, storeId, listId: campaignId },
      select: {
        id: true,
        productVariantId: true,
        barcode: true,
        currentPrice: true,
        maxPrice: true,
        customPrice: true,
        list: { select: CAMPAIGN_CONFIG_SELECT },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('MarketplaceCampaignItem', itemId);
  }

  const config = campaignConfigFromListRow(item.list);
  const fundingPct = new Decimal(item.list.trendyolFundingPct.toString());
  const currentPrice = new Decimal(item.currentPrice.toString());
  const maxPrice = new Decimal(item.maxPrice.toString());
  const savedCustomPrice =
    item.customPrice !== null ? new Decimal(item.customPrice.toString()) : null;

  // Validate BEFORE touching the catalog: a rejected price should not cost a batch of joins.
  const { price, applyCampaign } = resolveScenarioPrice(
    body,
    currentPrice,
    maxPrice,
    savedCustomPrice,
  );

  const economics = await resolveCampaignEconomics(orgId, storeId, store, item.list.startsAt, [
    item,
  ]);
  const inputs = economics.byItemId.get(item.id) ?? EMPTY_ITEM_ECONOMICS;

  const computed = computeCampaignEstimate(
    economics.ctx,
    inputs.variant,
    inputs.cost,
    inputs.shipping,
    inputs.commission,
    { price, currentPrice, config, fundingPct, applyCampaign },
  );

  return {
    itemId: item.id,
    scenario: body.scenario,
    price: computed.price.toFixed(2),
    ...unitFundingSplit(applyCampaign, computed.scope, price, config, fundingPct),
    commissionPct: computed.commissionPct,
    commissionSource: computed.commissionSource,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
    breakdownScope: computed.scope,
    basket: computed.basket,
    commissionTariffName: economics.tariffName,
    commissionPeriodLabel: economics.periodLabel,
  };
}

/**
 * The per-unit split of a campaign price: what the customer pays and what Trendyol funds.
 *
 * `price` on the result is what the SELLER earns; these two open up the gap between that and
 * what the customer actually paid — the whole point of modelling a funding rate. They exist
 * because the result's `basket` (which carries the same split as basket totals) is null at unit
 * scope — `NET` and the conditional PERCENT variants, i.e. most live campaigns — so without them
 * the seller could not see Trendyol's contribution at all in exactly the configurations where it
 * matters most.
 *
 * Null in two cases, both deliberate:
 *  - the campaign-free `current` scenario — there is no promotion, so there is nothing to split;
 *  - ORDER scope — there `effectiveUnitPrice` is a SYNTHETIC AVERAGE by construction (in a
 *    2-al-1-öde the customer pays full price for one unit and nothing for the other, so "half
 *    price per unit" describes no unit that exists). Handing that average back under a
 *    `...UnitPrice` name would re-introduce precisely the reasoning ORDER presentation exists to
 *    prevent, and it would sit next to an order-scoped `price` that a consumer could subtract it
 *    from. ORDER results surface the split as basket totals through their `basket`.
 *
 * The funded amount is the DIFFERENCE of the two 2-decimal figures (never the rate re-applied),
 * so paid + funded closes on the unit settlement price to the kuruş.
 */
function unitFundingSplit(
  applyCampaign: boolean,
  scope: 'unit' | 'order',
  price: Decimal,
  config: DiscountConfig,
  fundingPct: Decimal,
): { customerPaidUnitPrice: string | null; trendyolFundedUnitAmount: string | null } {
  if (!applyCampaign || scope === 'order') {
    return { customerPaidUnitPrice: null, trendyolFundedUnitAmount: null };
  }
  const paidUnit = effectiveUnitPrice(price, config).toDecimalPlaces(2);
  const sellerUnit = sellerEffectivePrice(price, config, fundingPct).toDecimalPlaces(2);
  return {
    customerPaidUnitPrice: paidUnit.toFixed(2),
    trendyolFundedUnitAmount: sellerUnit.sub(paidUnit).toFixed(2),
  };
}

// ─── Target-margin suggestion ─────────────────────────────────────────────────

/**
 * Suggests, per item, the smallest campaign price that reaches `targetMarginPct`. Throws
 * `NotFoundError` when the campaign is not in this store.
 *
 * COMPUTES AND RETURNS — it writes NOTHING. The client drops the suggested prices into its
 * local buffer; they become persistent only when the seller saves through the selections
 * endpoint. Storing them here would make two places disagree about what the seller chose.
 *
 * Items come back in the campaign's own order so the client can zip them onto its rows.
 */
export async function suggestCampaignTargetMargin(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  campaignId: string,
  targetMarginPct: Decimal,
): Promise<TargetMarginResult> {
  let list;
  try {
    list = await prisma.marketplaceCampaignList.findFirst({
      where: { id: campaignId, organizationId: orgId, storeId },
      select: {
        ...CAMPAIGN_CONFIG_SELECT,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, productVariantId: true, barcode: true, maxPrice: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (list === null) {
    throw new NotFoundError('MarketplaceCampaign', campaignId);
  }

  const config = campaignConfigFromListRow(list);
  const fundingPct = new Decimal(list.trendyolFundingPct.toString());

  if (list.items.length === 0) return { suggestions: [] };

  const economics = await resolveCampaignEconomics(
    orgId,
    storeId,
    store,
    list.startsAt,
    list.items,
  );

  const items: CampaignTargetMarginItem[] = list.items.map((item): CampaignTargetMarginItem => {
    const inputs = economics.byItemId.get(item.id) ?? EMPTY_ITEM_ECONOMICS;
    return {
      itemId: item.id,
      variant: inputs.variant,
      cost: inputs.cost,
      shipping: inputs.shipping,
      commission: inputs.commission,
      maxPrice: new Decimal(item.maxPrice.toString()),
    };
  });

  return {
    suggestions: suggestTargetMarginPrices(economics.ctx, items, {
      config,
      fundingPct,
      targetMarginPct,
    }),
  };
}
