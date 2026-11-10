// Per-list discount configuration, narrowed from the DiscountList row by the
// validator's discriminated union. Every V1 kurgu reduces to ONE contract:
// effectiveUnitPrice -- the per-unit selling price under the "single-product
// basket at the minimum qualifying quantity + proportional split" assumption
// (design 5.1). The profit engine never learns discount types.
//
// The type-agnostic scenario primitives (priceScenario / toScenario / toEstimate /
// scenarioBreakdown) live in `discount-scenario-commons.ts` and now run on the scenario
// engine (`@pazarsync/profit`). This file keeps only what is Indirimler-specific: the two-
// scenario item and its basket framing. Each screen hands the engine the econ it loaded as
// a `ScreenScenarioBase`; the commission is resolved by the three-tier chain and passed as
// the engine's rate override.

import { Decimal } from 'decimal.js';

import {
  assumedBasketQuantity,
  commissionBandPrice,
  effectiveUnitPrice,
  type DiscountCommissionInputs,
  type DiscountConfig,
} from './discount-math-commons';
import {
  priceScenario,
  scenarioBreakdown,
  scenarioMarginPct,
  scenarioNetProfit,
  toEstimate,
  toScenario,
  type ComputedPriceScenario,
  type ComputedScenarioEstimate,
  type ScenarioItemReason,
} from './discount-scenario-commons';
import { toKurusHalfUp, type ScreenScenarioBase } from './scenario-screen-commons';

const ZERO = new Decimal(0);

// --- Per-scenario profit compute ---

export type DiscountItemReason = ScenarioItemReason;

export type ComputedDiscountScenario = ComputedPriceScenario;

/**
 * Order-scope settlement scenario (design 11, profit-formula.md 2.4): assuming the basket is made
 * only of THIS product at the minimum qualifying quantity `assumedQuantity` (n), the basket's list
 * total, what the customer pays, the discount, and the ORDER net profit (`orderNetProfit` with its
 * margin `orderMarginPct`) alongside the campaign-free same-basis baseline (`currentOrderNetProfit`).
 * Both order profits run the real scenario engine over the n-unit basket (n cost units, one shipping,
 * one platform fee -- the platform service and shipping are per-parcel, and desi scales by n). Null
 * for NET (its showcase price genuinely changes -- no basket framing) or a non-positive price. Money
 * fields are 2dp strings; the profit engine's Decimal drives them, never a float.
 */
export interface DiscountBasketScenario {
  readonly assumedQuantity: number;
  readonly basketTotal: string; // toFixed(2)
  readonly basketPaidTotal: string; // toFixed(2)
  readonly basketDiscountTotal: string; // toFixed(2)
  readonly orderNetProfit: string | null; // discounted order net profit (n-unit basket)
  readonly orderMarginPct: string | null; // orderNetProfit / basketPaidTotal x 100
  readonly currentOrderNetProfit: string | null; // same n-unit basis, campaign-free
}

export interface ComputedDiscountItem {
  readonly calculable: boolean;
  readonly reason: DiscountItemReason | null;
  readonly current: ComputedDiscountScenario;
  readonly discounted: ComputedDiscountScenario;
  readonly scenario: DiscountBasketScenario | null;
}

/**
 * Builds the ORDER-scope settlement scenario (design 11, profit-formula.md 2.4) from the current
 * price, the discounted effective unit, the config, and the item's loaded scenario base + commission
 * chain. `assumedQuantity` (n) is the minimum qualifying quantity per type. `basketPaidTotal` uses
 * the SAME 2dp effective unit the row displays, so the popover can never disagree with the shown unit
 * price. Returns null for NET (its showcase price genuinely changes -- no basket framing) or a
 * non-positive current price.
 *
 * Order model: both order net profits run the engine over an n-unit basket via `priceScenario`
 * with `quantity: n` -- the engine prices n cost units, one shipping and one platform-service fee per
 * parcel (profit-formula.md 2.4), and desi scales by n (so a big basket can exceed the carrier's
 * desi limit and that order profit is null while the row stays). `orderNetProfit` prices the
 * discounted basket (unitPrice = the rounded effective unit, band chosen from the UNIT price);
 * `currentOrderNetProfit` prices the same n units campaign-free at the current price -- an
 * apples-to-apples baseline. `orderMarginPct` is the discounted order statement's own saleMarginPct
 * (netProfit / basketPaidTotal x 100), which the engine returns as null when the paid basket is zero.
 * Each value is null when its scenario is not calculable (unmatched, no commission, missing
 * cost/shipping, or a desi overflow). All arithmetic is Decimal.
 */
function buildBasketScenario(
  base: ScreenScenarioBase,
  commission: DiscountCommissionInputs,
  currentPrice: Decimal,
  discountedPrice: Decimal,
  discountedBandPrice: Decimal,
  config: DiscountConfig,
): DiscountBasketScenario | null {
  if (config.type === 'NET' || currentPrice.lte(ZERO)) return null;

  const n = assumedBasketQuantity(config, currentPrice);
  const unit2dp = toKurusHalfUp(discountedPrice);
  const basketTotal = currentPrice.mul(n);
  const basketPaidTotal = unit2dp.mul(n);

  const discountedOrder = priceScenario({
    base,
    commission,
    price: discountedPrice,
    bandPrice: discountedBandPrice,
    quantity: n,
  });
  const currentOrder = priceScenario({
    base,
    commission,
    price: currentPrice,
    bandPrice: currentPrice,
    quantity: n,
  });

  return {
    assumedQuantity: n,
    basketTotal: basketTotal.toFixed(2),
    basketPaidTotal: basketPaidTotal.toFixed(2),
    basketDiscountTotal: basketTotal.sub(basketPaidTotal).toFixed(2),
    orderNetProfit: scenarioNetProfit(discountedOrder),
    orderMarginPct: scenarioMarginPct(discountedOrder),
    currentOrderNetProfit: scenarioNetProfit(currentOrder),
  };
}

/**
 * Computes one discount item's TWO scenarios: `current` at `currentPrice` (band + matrah
 * both the current price), and `discounted` whose MATRAH is effectiveUnitPrice(currentPrice,
 * config) but whose commission BAND is selected by {@link commissionBandPrice} -- the
 * discounted price for genuinely-cheaper-per-unit types, the current (list) price for
 * X-al-Y / Nth-product where the list price is unchanged. The item's calculability + reason
 * follow the `current` (baseline) scenario -- the "do nothing" state the list row shows. The
 * basket-scoped `scenario` block ({@link buildBasketScenario}) reframes the discounted unit as
 * the settlement-basis unit under the single-product-basket assumption (null for NET).
 */
export function computeDiscountItem(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  readonly currentPrice: Decimal;
  readonly config: DiscountConfig;
}): ComputedDiscountItem {
  const { base, commission, currentPrice, config } = params;
  const discountedPrice = effectiveUnitPrice(currentPrice, config);
  const discountedBandPrice = commissionBandPrice(currentPrice, discountedPrice, config);
  const current = priceScenario({ base, commission, price: currentPrice, bandPrice: currentPrice });
  const discounted = priceScenario({
    base,
    commission,
    price: discountedPrice,
    bandPrice: discountedBandPrice,
  });
  return {
    calculable: current.calculable,
    reason: current.reason,
    current: toScenario(currentPrice, current),
    discounted: toScenario(discountedPrice, discounted),
    scenario: buildBasketScenario(
      base,
      commission,
      currentPrice,
      discountedPrice,
      discountedBandPrice,
      config,
    ),
  };
}

// --- Single-scenario estimate (breakdown modal) ---

export type ComputedDiscountEstimate = ComputedScenarioEstimate;

/**
 * Full profit breakdown for ONE discount item: `price` is the MATRAH (already chosen by the
 * caller: the current price, or effectiveUnitPrice for the discounted scenario) and
 * `bandPrice` is the price the commission BAND is selected from (from {@link commissionBandPrice}
 * -- equal to `price` for the current scenario and the genuinely-cheaper types, the current
 * price for X-al-Y / Nth-product). The breakdown is built from the scenario statement at the
 * 2dp unit price -- the same numbers the detail row's matching scenario shows, so the modal
 * never disagrees with the row.
 */
export function computeDiscountEstimate(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  readonly price: Decimal;
  readonly bandPrice: Decimal;
}): ComputedDiscountEstimate {
  const c = priceScenario({
    base: params.base,
    commission: params.commission,
    price: params.price,
    bandPrice: params.bandPrice,
  });
  return toEstimate(c, scenarioBreakdown(c));
}
