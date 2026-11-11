// On-demand profit estimate for a single Indirimler (discount list) item.
//
// Backs the breakdown modal without bloating the detail payload. It resolves the SAME
// inputs the detail resolves for ONE item -- the three-tier commission chain (the store's
// covering commission tariff bands, the variant's synced commission, the category rate) and
// the variant's scenario base (cost, shipping, fees, VAT, desi, from the engine loader) --
// then runs the scenario engine via `computeDiscountEstimate`. No financial math lives here;
// the chosen scenario's breakdown matches the detail row's matching scenario (same price,
// same resolved commission). An ORDER-presentation list frames the DISCOUNTED scenario as
// the whole n-unit campaign basket via one engine evaluation with `quantity: n`.
//
// Scoped by organizationId + storeId + list. A cross-tenant or foreign item id is
// indistinguishable from a missing one (404). A per-request profit failure degrades to an
// empty breakdown with one logged line (decision 9), never a 500.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { loadCommissionRulesForCategories, resolveTrendyolCategoryRate } from '@pazarsync/profit';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError } from '../lib/errors';
import { resolveDiscountCommissionSource } from './discount-commission-source';
import { computeDiscountEstimate, type ComputedDiscountEstimate } from './discount-compute.service';
import {
  assumedBasketQuantity,
  commissionBandPrice,
  effectiveUnitPrice,
  scenarioPresentation,
  type DiscountCommissionInputs,
} from './discount-math-commons';
import { priceScenario, scenarioBreakdown, toEstimate } from './discount-scenario-commons';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import {
  loadScreenScenarioBases,
  screenScenarioBaseFor,
  toKurusHalfUp,
  type ScreenScenarioBase,
} from './scenario-screen-commons';
import {
  discountConfigFromListRow,
  type EstimateDiscountItemResult,
} from '../validators/discount-list.validator';

/** Which of the detail row's two scenarios to price. */
export type DiscountEstimateScenario = 'current' | 'discounted';

/**
 * Computes the full profit breakdown for one discount item under `scenario`. Throws
 * `NotFoundError` when the item does not belong to this list/store. `current` prices the
 * item's current price; `discounted` prices effectiveUnitPrice(currentPrice, config) --
 * the list config comes from the item's list row via `discountConfigFromListRow`, so the
 * two config bridges share one truth. The commission is re-resolved at the chosen price.
 */
export async function estimateDiscountItem(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  listId: string,
  itemId: string,
  scenario: DiscountEstimateScenario,
): Promise<EstimateDiscountItemResult> {
  let item;
  try {
    item = await prisma.discountListItem.findFirst({
      where: { id: itemId, organizationId: orgId, storeId, listId },
      select: {
        id: true,
        productVariantId: true,
        barcode: true,
        currentPrice: true,
        list: {
          select: {
            discountType: true,
            valueKind: true,
            value: true,
            minBasketAmount: true,
            minQuantity: true,
            buyQuantity: true,
            payQuantity: true,
            nthIndex: true,
            startsAt: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('DiscountListItem', itemId);
  }

  const config = discountConfigFromListRow(item.list);
  const currentPrice = new Decimal(item.currentPrice.toString());
  const price = scenario === 'current' ? currentPrice : effectiveUnitPrice(currentPrice, config);
  // The band-lookup price: equal to `price` for the current scenario and for genuinely-
  // cheaper-per-unit types; the CURRENT (list) price for X-al-Y / Nth-product. The matrah
  // (`price`) is untouched -- only which price selects the commission band changes.
  const bandPrice = commissionBandPrice(currentPrice, price, config);

  const now = new Date();

  // Resolve the matched variant's chain inputs + its scenario base once (only when the item
  // matched a catalog variant). The slim query keeps what the chain + the category fallback
  // need: the synced rate (2nd tier) and the category/brand (3rd tier). The econ (cost,
  // shipping, fees, VAT, desi) comes from the scenario base, not from here.
  let productRate: Decimal | null = null;
  let categoryRate: Decimal | null = null;
  const variantIds = item.productVariantId !== null ? [item.productVariantId] : [];

  if (item.productVariantId !== null) {
    let variantRow;
    try {
      variantRow = await prisma.productVariant.findFirst({
        where: { id: item.productVariantId, organizationId: orgId, storeId },
        select: {
          id: true,
          syncedCommissionRate: true,
          product: { select: { categoryId: true, brandId: true } },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    if (variantRow !== null && variantRow.syncedCommissionRate !== null) {
      productRate = new Decimal(variantRow.syncedCommissionRate.toString());
    }
    if (variantRow !== null && variantRow.product.categoryId !== null) {
      const { categoryId, brandId } = variantRow.product;
      const commissionRules = await loadCommissionRulesForCategories(prisma, {
        categoryIds: [categoryId],
      });
      const resolved = resolveTrendyolCategoryRate({
        rules: commissionRules,
        categoryId: categoryId.toString(),
        brandId: brandId === null ? null : brandId.toString(),
      });
      categoryRate = resolved?.ratePct ?? null;
    }
  }

  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: now,
    variantIds,
    surface: 'discount-list',
  });
  const base: ScreenScenarioBase = screenScenarioBaseFor(bases, item.productVariantId);

  // Bands come from the store's commission tariff ONLY when a tariff week covers the anchor
  // instant -- matched by barcode. The SAME source the detail view uses
  // (discount-commission-source.ts); the estimate ignores the outdated flag (the modal shows
  // the period label, so the list-level note is the detail's job).
  const { resolution: source } = await resolveDiscountCommissionSource(
    orgId,
    storeId,
    item.list.startsAt,
    now,
  );
  const bands = source?.bandsByBarcode.get(item.barcode) ?? null;

  const commission: DiscountCommissionInputs = { bands, productRate, categoryRate };

  // ORDER-presentation lists (BUY_X_PAY_Y / NTH_PRODUCT / a conditional-AMOUNT discount) frame the
  // DISCOUNTED scenario as the whole campaign order, not one unit: the modal then shows the SAME
  // order breakdown the detail row's settlement scenario is built from -- both go through one
  // engine evaluation with `quantity: n`, so they can never disagree. Every other case keeps the
  // UNIT breakdown.
  const wantOrder = scenarioPresentation(config) === 'ORDER' && scenario === 'discounted';
  const n = wantOrder ? assumedBasketQuantity(config, currentPrice) : 1;
  const resultPrice = wantOrder ? toKurusHalfUp(price).mul(n) : price;

  // A per-item engine throw degrades to an empty breakdown with one logged line (decision 9),
  // never a 500. The transparency labels (resolved above) still surface.
  let computed: ComputedDiscountEstimate;
  try {
    computed = wantOrder
      ? estimateOrder(base, commission, price, bandPrice, n)
      : computeDiscountEstimate({ base, commission, price, bandPrice });
  } catch (err) {
    logProfitReadFailure({ surface: 'discount-list', organizationId: orgId, orderId: null, err });
    computed = {
      calculable: false,
      reason: null,
      commissionPct: null,
      commissionSource: null,
      breakdown: null,
    };
  }

  return {
    itemId: item.id,
    scenario,
    price: resultPrice.toFixed(2),
    commissionPct: computed.commissionPct,
    commissionSource: computed.commissionSource,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
    // `unit` = per-unit economics; `order` = the whole n-unit campaign basket (only for the
    // discounted scenario of an ORDER-presentation list -- see `wantOrder`).
    breakdownScope: wantOrder ? 'order' : 'unit',
    // Transparency: which tariff/period fed the band tier (from the resolution, when one
    // existed -- even if THIS item fell through to product/category; null otherwise).
    commissionTariffName: source?.tariffName ?? null,
    commissionPeriodLabel: source?.periodLabel ?? null,
  };
}

/**
 * The ORDER-scope estimate: one engine evaluation of the n-unit basket (`quantity: n`,
 * unit price = the 2dp effective unit, band chosen from the UNIT price). Calculability,
 * reason and commission come from the SAME order evaluation; the breakdown's list price is
 * the order revenue (the 2dp unit times n) read from that evaluation's SALE line, so the modal
 * matches the detail row's settlement scenario.
 */
function estimateOrder(
  base: ScreenScenarioBase,
  commission: DiscountCommissionInputs,
  price: Decimal,
  bandPrice: Decimal,
  n: number,
): ComputedDiscountEstimate {
  const c = priceScenario({ base, commission, price, bandPrice, quantity: n });
  return toEstimate(c, scenarioBreakdown(c));
}
