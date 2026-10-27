// Per-list discount configuration, narrowed from the DiscountList row by the
// validator's discriminated union. Every V1 kurgu reduces to ONE contract:
// effectiveUnitPrice — the per-unit selling price under the "single-product
// basket at the minimum qualifying quantity + proportional split" assumption
// (design §5.1). The profit engine never learns discount types.
//
// The type-agnostic scenario primitives (priceScenario / toScenario / toEstimate /
// computeOrderBreakdown) live in `discount-scenario-commons.ts` — Kampanyalar is their
// second consumer. This file keeps only what is İndirimler-specific: the two-scenario
// item and its basket framing.

import { Decimal } from 'decimal.js';

import type { EstimateOutcome } from '@pazarsync/profit';

import {
  assumedBasketQuantity,
  commissionBandPrice,
  effectiveUnitPrice,
  type DiscountCommissionInputs,
  type DiscountConfig,
  type ResolvedDiscountCommission,
} from './discount-math-commons';
import {
  computeOrderBreakdown,
  priceScenario,
  toEstimate,
  toScenario,
  type ComputedPriceScenario,
  type ComputedScenarioEstimate,
  type ScenarioItemReason,
} from './discount-scenario-commons';
import type { TariffAssemblyContext, TariffVariant } from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';

// Re-exported so the detail + estimate services import the assembly context/variant
// shapes — and the order-scope breakdown — from one place, alongside the discount-specific
// chain types below.
export type { TariffAssemblyContext, TariffVariant };
export { computeOrderBreakdown };

const ZERO = new Decimal(0);

// ─── Per-scenario profit compute ─────────────────────────────────────────────

export type DiscountItemReason = ScenarioItemReason;

export type ComputedDiscountScenario = ComputedPriceScenario;

/**
 * Order-scope settlement scenario (design §11, profit-formula.md §2.4): assuming the basket is made
 * only of THIS product at the minimum qualifying quantity `assumedQuantity` (n), the basket's list
 * total, what the customer pays, the discount, and the ORDER net profit (`orderNetProfit` with its
 * margin `orderMarginPct`) alongside the campaign-free same-basis baseline (`currentOrderNetProfit`).
 * Both order profits run the real profit engine over the n-unit basket (n× product cost, 1× shipping,
 * 1× PSF — the platform service and shipping are per-parcel). Null for NET (its showcase price
 * genuinely changes — no basket framing) or a non-positive price. Money fields are 2dp strings; the
 * profit engine's Decimal drives them, never a float.
 */
export interface DiscountBasketScenario {
  readonly assumedQuantity: number;
  readonly basketTotal: string; // toFixed(2)
  readonly basketPaidTotal: string; // toFixed(2)
  readonly basketDiscountTotal: string; // toFixed(2)
  readonly orderNetProfit: string | null; // toFixed(2) — discounted order net profit (n-unit basket)
  readonly orderMarginPct: string | null; // toFixed(2) — orderNetProfit / basketPaidTotal × 100
  readonly currentOrderNetProfit: string | null; // toFixed(2) — same n-unit basis, campaign-free
}

export interface ComputedDiscountItem {
  readonly calculable: boolean;
  readonly reason: DiscountItemReason | null;
  readonly current: ComputedDiscountScenario;
  readonly discounted: ComputedDiscountScenario;
  readonly scenario: DiscountBasketScenario | null;
}

/**
 * Builds the ORDER-scope settlement scenario (design §11, profit-formula.md §2.4) from the current
 * price, the discounted effective unit, the config, and BOTH scenarios' resolved commissions.
 * `assumedQuantity` (n) is the minimum qualifying quantity per type. `basketPaidTotal` uses the SAME
 * 2dp effective unit the row displays (`unit2dp`), so the popover can never disagree with the shown
 * unit price. Returns null for NET (its showcase price genuinely changes — no basket framing) or a
 * non-positive current price.
 *
 * Order model: both order net profits run the REAL engine over an n-unit basket via
 * {@link computeOrderBreakdown} — n× product cost, 1× shipping, 1× PSF (profit-formula.md §2.4: the
 * platform service and shipping are per-PARCEL, and a basket of n identical units ships once).
 * `orderNetProfit` prices the discounted basket at `basketPaidTotal`; `currentOrderNetProfit` prices
 * the same n units campaign-free at `basketTotal` — an apples-to-apples baseline. `orderMarginPct` is
 * the discounted order breakdown's own saleMarginPct (netProfit / basketPaidTotal × 100), which the
 * engine returns as null when the paid basket is zero. Each value is null when its scenario's order
 * breakdown is null (unmatched, no commission, or missing cost/shipping). Commission/stoppage/VAT
 * follow the engine formula. All arithmetic is Decimal.
 */
function buildBasketScenario(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  currentPrice: Decimal,
  discountedPrice: Decimal,
  config: DiscountConfig,
  currentResolved: ResolvedDiscountCommission | null,
  discountedResolved: ResolvedDiscountCommission | null,
): DiscountBasketScenario | null {
  if (config.type === 'NET' || currentPrice.lte(ZERO)) return null;

  const n = assumedBasketQuantity(config, currentPrice);
  const unit2dp = discountedPrice.toDecimalPlaces(2);
  const basketTotal = currentPrice.mul(n);
  const basketPaidTotal = unit2dp.mul(n);

  const discountedOrder = computeOrderBreakdown(
    ctx,
    variant,
    cost,
    shipping,
    discountedResolved,
    n,
    basketPaidTotal,
  );
  const currentOrder = computeOrderBreakdown(
    ctx,
    variant,
    cost,
    shipping,
    currentResolved,
    n,
    basketTotal,
  );

  return {
    assumedQuantity: n,
    basketTotal: basketTotal.toFixed(2),
    basketPaidTotal: basketPaidTotal.toFixed(2),
    basketDiscountTotal: basketTotal.sub(basketPaidTotal).toFixed(2),
    orderNetProfit: discountedOrder !== null ? discountedOrder.netProfit.toFixed(2) : null,
    orderMarginPct:
      discountedOrder !== null && discountedOrder.saleMarginPct !== null
        ? discountedOrder.saleMarginPct.toFixed(2)
        : null,
    currentOrderNetProfit: currentOrder !== null ? currentOrder.netProfit.toFixed(2) : null,
  };
}

/**
 * Computes one discount item's TWO scenarios: `current` at `currentPrice` (band + matrah
 * both the current price), and `discounted` whose MATRAH is effectiveUnitPrice(currentPrice,
 * config) but whose commission BAND is selected by {@link commissionBandPrice} — the
 * discounted price for genuinely-cheaper-per-unit types, the current (list) price for
 * X-al-Y / Nth-product where the list price is unchanged. The item's calculability + reason
 * follow the `current` (baseline) scenario — the "do nothing" state the list row shows. The
 * basket-scoped `scenario` block ({@link buildBasketScenario}) reframes the discounted unit as
 * the settlement-basis unit under the single-product-basket assumption (null for NET).
 */
export function computeDiscountItem(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  currentPrice: Decimal,
  config: DiscountConfig,
): ComputedDiscountItem {
  const discountedPrice = effectiveUnitPrice(currentPrice, config);
  const discountedBandPrice = commissionBandPrice(currentPrice, discountedPrice, config);
  const current = priceScenario(
    ctx,
    variant,
    cost,
    shipping,
    commission,
    currentPrice,
    currentPrice,
  );
  const discounted = priceScenario(
    ctx,
    variant,
    cost,
    shipping,
    commission,
    discountedPrice,
    discountedBandPrice,
  );
  return {
    calculable: current.calculable,
    reason: current.reason,
    current: toScenario(currentPrice, current),
    discounted: toScenario(discountedPrice, discounted),
    scenario: buildBasketScenario(
      ctx,
      variant,
      cost,
      shipping,
      currentPrice,
      discountedPrice,
      config,
      current.resolved,
      discounted.resolved,
    ),
  };
}

// ─── Single-scenario estimate (breakdown modal) ──────────────────────────────

export type ComputedDiscountEstimate = ComputedScenarioEstimate;

/**
 * Full profit breakdown for ONE discount item: `price` is the MATRAH (already chosen by the
 * caller: the current price, or effectiveUnitPrice for the discounted scenario) and
 * `bandPrice` is the price the commission BAND is selected from (from {@link commissionBandPrice}
 * — equal to `price` for the current scenario and the genuinely-cheaper types, the current
 * price for X-al-Y / Nth-product). Serializes the breakdown — the same numbers the detail
 * row's matching scenario shows, so the modal never disagrees with the row.
 */
export function computeDiscountEstimate(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  price: Decimal,
  bandPrice: Decimal,
): ComputedDiscountEstimate {
  const c = priceScenario(ctx, variant, cost, shipping, commission, price, bandPrice);
  return toEstimate(c, c.breakdown);
}
