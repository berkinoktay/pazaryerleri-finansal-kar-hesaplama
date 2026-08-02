// On-demand profit estimate + target-margin price suggestion for Kampanyalar
// (Trendyol-designed campaign participation).
//
// Two read-only entry points, both scoped by organizationId + storeId + campaign:
//
//   estimateCampaignItem      → the breakdown modal's data for ONE item under ONE of the
//                               three scenarios (current / max / custom).
//   suggestCampaignTargetMargin → a suggested campaign price per item for a target margin.
//
// NEITHER WRITES ANYTHING. The seller's price choices live in an ephemeral client buffer
// until "Kaydet ve İndir" posts them to the selections endpoint; persisting a suggestion
// here would create a second source of truth for the same state (design §6).
//
// No financial math lives in this file. Prices, commission and the profit engine all run
// through the SHARED compute (`marketplace-campaign-compute.service.ts`) that the detail view
// uses, so the modal can never disagree with the row it was opened from.
//
// A cross-tenant or foreign campaign/item id is indistinguishable from a missing one (404).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { CampaignPriceSelection } from '@pazarsync/db/enums';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError, ValidationError } from '../lib/errors';
import { resolveCommissionRate } from './commission-rate-resolver';
import { resolveDiscountCommissionSource } from './discount-commission-source';
import {
  assumedBasketQuantity,
  effectiveUnitPrice,
  resolveDiscountCommission,
  scenarioPresentation,
  sellerEffectivePrice,
  type DiscountCommissionInputs,
  type DiscountConfig,
} from './discount-math-commons';
import { computeOrderBreakdown } from './discount-scenario-commons';
import {
  computeCampaignEstimate,
  suggestTargetMarginPrices,
  type CampaignTargetMarginItem,
  type TariffAssemblyContext,
  type TariffVariant,
} from './marketplace-campaign-compute.service';
import { fetchCostAggregates } from './products-list.service';
import {
  batchResolveShipping,
  resolveFeeDefs,
  serializeBreakdown,
  type QuoteBreakdown,
} from './product-pricing.service';
import { NO_SHIPPING } from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
import {
  campaignConfigFromListRow,
  type EstimateCampaignItemBody,
  type EstimateCampaignItemResult,
  type TargetMarginResult,
} from '../validators/marketplace-campaign.validator';

const ZERO = new Decimal(0);

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

// ─── Shared economics resolution ──────────────────────────────────────────────

/** Everything one item needs to be priced, once the catalog joins are done. */
interface CampaignItemEconomics {
  readonly variant: TariffVariant | null;
  readonly cost: VariantCostAggregate | undefined;
  readonly shipping: EstimateOutcome;
  readonly commission: DiscountCommissionInputs;
}

interface CampaignEconomics {
  readonly ctx: TariffAssemblyContext;
  readonly byItemId: ReadonlyMap<string, CampaignItemEconomics>;
  /** Which commission tariff / period fed the bands (null when none covered the anchor). */
  readonly tariffName: string | null;
  readonly periodLabel: string | null;
}

/** The item columns the economics resolution joins on. */
interface CampaignEconomicsRow {
  readonly id: string;
  readonly productVariantId: string | null;
  readonly barcode: string;
}

/**
 * Resolves the priced inputs for a set of campaign items in ONE batch: the matched variant
 * (+ its synced commission rate), cost aggregate, shipping estimate, the store's commission
 * tariff bands anchored to the campaign start, and a category-rate fallback per distinct
 * (category, brand) pair. The three tiers are handed to the compute as
 * `DiscountCommissionInputs`; the chain itself lives in `discount-math-commons`.
 *
 * Deliberately batched even for the single-item estimate (a one-element array): the estimate
 * and the target-margin suggestion then resolve their inputs through the SAME code, so a
 * suggested price and the modal that checks it can never be built on different data.
 */
async function resolveCampaignEconomics(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  anchor: Date | null,
  items: ReadonlyArray<CampaignEconomicsRow>,
): Promise<CampaignEconomics> {
  const variantIds = items.map((i) => i.productVariantId).filter((id): id is string => id !== null);

  const variantMap = new Map<string, TariffVariant & { syncedCommissionRate: Decimal | null }>();
  let costMap = new Map<string, VariantCostAggregate>();
  let shippingMap = new Map<string, EstimateOutcome>();

  if (variantIds.length > 0) {
    let variants;
    try {
      variants = await prisma.productVariant.findMany({
        where: { id: { in: variantIds }, organizationId: orgId, storeId },
        select: {
          id: true,
          stockCode: true,
          barcode: true,
          salePrice: true,
          vatRate: true,
          isDigital: true,
          syncedCommissionRate: true,
          product: { select: { title: true, categoryId: true, brandId: true } },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) {
      variantMap.set(variant.id, {
        ...variant,
        syncedCommissionRate:
          variant.syncedCommissionRate !== null
            ? new Decimal(variant.syncedCommissionRate.toString())
            : null,
      });
    }

    [costMap, shippingMap] = await Promise.all([
      fetchCostAggregates(orgId, variantIds),
      batchResolveShipping(orgId, storeId, variantIds),
    ]);
  }

  // Bands are authoritative ONLY from a tariff week COVERING the campaign start — the SAME
  // shared resolver the detail view anchors with. `outdated` is the detail's concern (the
  // modal shows the period label), so it is ignored here.
  const { resolution: source } = await resolveDiscountCommissionSource(
    orgId,
    storeId,
    anchor,
    new Date(),
  );

  // Category-rate fallback (3rd tier), resolved once per distinct (category, brand).
  const categoryRateByKey = new Map<string, Decimal | null>();
  const distinctCatKeys = new Map<string, { categoryId: bigint; brandId: bigint | null }>();
  for (const variant of variantMap.values()) {
    const { categoryId, brandId } = variant.product;
    if (categoryId === null) continue;
    distinctCatKeys.set(`${categoryId}:${brandId ?? 'null'}`, { categoryId, brandId });
  }
  await Promise.all(
    [...distinctCatKeys].map(async ([key, { categoryId, brandId }]) => {
      const resolved = await resolveCommissionRate({
        platform: store.platform,
        categoryId,
        brandId,
        sellerSegment: null,
      });
      categoryRateByKey.set(key, resolved?.rate ?? null);
    }),
  );

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));

  const byItemId = new Map<string, CampaignItemEconomics>();
  for (const item of items) {
    const variantRow =
      item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
    const categoryRate =
      variantRow !== undefined && variantRow.product.categoryId !== null
        ? (categoryRateByKey.get(
            `${variantRow.product.categoryId}:${variantRow.product.brandId ?? 'null'}`,
          ) ?? null)
        : null;

    byItemId.set(item.id, {
      variant: variantRow ?? null,
      cost: item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined,
      shipping:
        item.productVariantId !== null
          ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
          : NO_SHIPPING,
      commission: {
        bands: source?.bandsByBarcode.get(item.barcode) ?? null,
        productRate: variantRow?.syncedCommissionRate ?? null,
        categoryRate,
      },
    });
  }

  return {
    ctx: { platform: store.platform, feeDefs },
    byItemId,
    tariffName: source?.tariffName ?? null,
    periodLabel: source?.periodLabel ?? null,
  };
}

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
 * Scope follows the CAMPAIGN's presentation, not the scenario. On an ORDER-presentation
 * campaign (`BUY_X_PAY_Y` / `NTH_PRODUCT` / a conditional-AMOUNT discount) the row's headline
 * figures are order totals — including the campaign-free `currentOrderNetProfit` — so the
 * `current` scenario returns the SAME assumed basket priced campaign-free (n × current price)
 * rather than a single unit. Without this the seller clicks an order number and reads a unit
 * breakdown that does not add up to it. (The İndirimler sibling still returns a unit
 * breakdown for its current scenario; back-porting it is tracked separately.)
 *
 * `n` is anchored on the price that frames the row's basket — the SAVED selection's price,
 * exactly as `computeCampaignItem` does — because that is the basket whose number the seller
 * clicked. For every ORDER type except a conditional-BASKET discount `n` does not depend on
 * price at all, so the anchor only matters there.
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
        selection: true,
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
  const inputs = economics.byItemId.get(item.id);
  if (inputs === undefined) {
    // Unreachable: the map is keyed from the same array. Explicit so the narrowing is honest.
    throw new NotFoundError('MarketplaceCampaignItem', itemId);
  }
  const { variant, cost, shipping, commission } = inputs;

  const computed = computeCampaignEstimate(economics.ctx, variant, cost, shipping, commission, {
    price,
    config,
    fundingPct,
    applyCampaign,
  });

  const order = currentOrderFraming(
    economics.ctx,
    inputs,
    config,
    body.scenario,
    currentPrice,
    basketAnchorPrice(item.selection, savedCustomPrice, maxPrice),
  );

  return {
    itemId: item.id,
    scenario: body.scenario,
    price: (order?.revenue ?? computed.price).toFixed(2),
    ...unitFundingSplit(applyCampaign, price, config, fundingPct),
    commissionPct: computed.commissionPct,
    commissionSource: computed.commissionSource,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: order !== null ? order.breakdown : computed.breakdown,
    breakdownScope: order !== null ? 'order' : computed.scope,
    commissionTariffName: economics.tariffName,
    commissionPeriodLabel: economics.periodLabel,
  };
}

/**
 * The campaign price the row's basket block is framed on: the seller's own price when they
 * SELECTED it, the maximum otherwise (including a typed-but-not-selected price and a CUSTOM
 * selection with no price yet). Mirrors `computeCampaignItem` so the modal's assumed basket
 * is the same basket the row totalled.
 */
function basketAnchorPrice(
  selection: CampaignPriceSelection,
  savedCustomPrice: Decimal | null,
  maxPrice: Decimal,
): Decimal {
  return selection === CampaignPriceSelection.CUSTOM && savedCustomPrice !== null
    ? savedCustomPrice
    : maxPrice;
}

/**
 * The campaign-free ORDER framing of the `current` scenario, or null when the scenario keeps
 * the unit framing (a UNIT-presentation campaign, any campaign scenario — the shared compute
 * already frames those — or a non-positive anchor price, where the row has no basket block
 * either).
 *
 * Revenue is n × the current price: no promotion, therefore no Trendyol funding, so the
 * seller's settlement total and what the customer pays are the same number. The commission is
 * resolved at the current price for both the matrah and the band, which is precisely what the
 * unit compute did for this scenario — the two cannot drift.
 */
function currentOrderFraming(
  ctx: TariffAssemblyContext,
  inputs: CampaignItemEconomics,
  config: DiscountConfig,
  scenario: EstimateCampaignItemBody['scenario'],
  currentPrice: Decimal,
  anchorPrice: Decimal,
): { readonly revenue: Decimal; readonly breakdown: QuoteBreakdown | null } | null {
  if (scenario !== 'current') return null;
  if (scenarioPresentation(config) !== 'ORDER') return null;
  if (anchorPrice.lte(ZERO)) return null;

  const n = assumedBasketQuantity(config, anchorPrice);
  const revenue = currentPrice.toDecimalPlaces(2).mul(n);
  const resolved = resolveDiscountCommission(inputs.commission, currentPrice.toDecimalPlaces(2));
  const breakdown = computeOrderBreakdown(
    ctx,
    inputs.variant,
    inputs.cost,
    inputs.shipping,
    resolved,
    n,
    revenue,
  );
  return { revenue, breakdown: breakdown !== null ? serializeBreakdown(breakdown) : null };
}

/**
 * The per-unit split of a campaign price: what the customer pays and what Trendyol funds.
 *
 * The seller's unit settlement price already rides on the result as `price` (at unit scope);
 * these two make the 900-vs-960 gap visible for EVERY configuration, not only the ones with a
 * basket block — most live campaigns are `Net %X İndirim`, where the basket block is null and
 * the funding was therefore invisible. Both are derived from the shared discount math the
 * compute uses, and the funded amount is written as the DIFFERENCE of the two 2-decimal
 * figures (never re-multiplied by the rate) so paid + funded closes on the settlement price to
 * the kuruş. Null for the campaign-free `current` scenario.
 */
function unitFundingSplit(
  applyCampaign: boolean,
  price: Decimal,
  config: DiscountConfig,
  fundingPct: Decimal,
): { customerPaidUnitPrice: string | null; trendyolFundedUnitAmount: string | null } {
  if (!applyCampaign) {
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
    const inputs = economics.byItemId.get(item.id);
    return {
      itemId: item.id,
      variant: inputs?.variant ?? null,
      cost: inputs?.cost,
      shipping: inputs?.shipping ?? NO_SHIPPING,
      commission: inputs?.commission ?? { bands: null, productRate: null, categoryRate: null },
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
