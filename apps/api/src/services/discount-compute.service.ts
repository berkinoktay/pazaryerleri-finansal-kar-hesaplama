// Per-list discount configuration, narrowed from the DiscountList row by the
// validator's discriminated union. Every V1 kurgu reduces to ONE contract:
// effectiveUnitPrice — the per-unit selling price under the "single-product
// basket at the minimum qualifying quantity + proportional split" assumption
// (design §5.1). The profit engine never learns discount types.

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type ProfitBreakdown } from '@pazarsync/profit';

import {
  assumedBasketQuantity,
  commissionBandPrice,
  effectiveUnitPrice,
  resolveDiscountCommission,
  type DiscountCommissionInputs,
  type DiscountCommissionSource,
  type DiscountConfig,
  type ResolvedDiscountCommission,
} from './discount-math-commons';
import {
  assembleUnitEconomics,
  serializeBreakdown,
  type QuoteBreakdown,
} from './product-pricing.service';
import {
  deriveReason,
  tariffCommission,
  type TariffAssemblyContext,
  type TariffItemReason,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';

// Re-exported so the detail + estimate services import the assembly context/variant
// shapes from one place, alongside the discount-specific chain types below.
export type { TariffAssemblyContext, TariffVariant };

const ZERO = new Decimal(0);

// ─── Per-scenario profit compute ─────────────────────────────────────────────

export type DiscountItemReason = TariffItemReason | 'NO_COMMISSION';

export interface ComputedDiscountScenario {
  readonly price: Decimal;
  readonly commissionPct: string | null; // toFixed(4)
  readonly commissionSource: DiscountCommissionSource | null;
  readonly netProfit: string | null; // toFixed(2)
  readonly marginPct: string | null; // toFixed(2)
}

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

/** One scenario's resolution: the commission chain result + the assembled breakdown. */
interface ScenarioCompute {
  readonly resolved: ResolvedDiscountCommission | null;
  readonly calculable: boolean;
  readonly reason: DiscountItemReason | null;
  readonly breakdown: ProfitBreakdown | null;
}

/**
 * Resolves the commission at `bandPrice` (the price that SELECTS the band — for list-price-
 * anchored discounts this is the current price, not the displayed discounted price; see
 * {@link commissionBandPrice}), then assembles the variant's econ and runs the engine on
 * `price` (the MATRAH — the effective revenue, always). Reason order: variant null →
 * NO_PRODUCT (the true root cause of an UNMATCHED catalog row — gated first so it is never
 * masked by an unresolvable commission), then commission null → NO_COMMISSION, then the
 * cost/shipping gate (deriveReason). A matched row's outcome is unaffected by this ordering
 * — it can never hit the NO_PRODUCT branch.
 */
function priceScenario(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  price: Decimal,
  bandPrice: Decimal,
): ScenarioCompute {
  // Resolve the band at the 2dp band-lookup price. A full-precision value (e.g. 299.992 from
  // NET %20 on 374.99) must not slip through the 0.01 gap between inclusive 2dp band
  // boundaries — chain and display must agree. The rate then applies to the matrah `price`.
  const resolved = resolveDiscountCommission(commission, bandPrice.toDecimalPlaces(2));
  if (variant === null) {
    return { resolved, calculable: false, reason: 'NO_PRODUCT', breakdown: null };
  }
  if (resolved === null) {
    return { resolved: null, calculable: false, reason: 'NO_COMMISSION', breakdown: null };
  }
  const probe = assembleUnitEconomics(ctx, variant, {
    costAggregate: cost,
    commission: tariffCommission(resolved.pct),
    shipping,
  });
  if (probe.econ === null) {
    return {
      resolved,
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      breakdown: null,
    };
  }
  return {
    resolved,
    calculable: true,
    reason: null,
    breakdown: computeUnitProfit(probe.econ, price),
  };
}

/** Serializes a scenario compute to the wire scenario (money 2dp, commission 4dp). */
function toScenario(price: Decimal, c: ScenarioCompute): ComputedDiscountScenario {
  return {
    price,
    commissionPct: c.resolved !== null ? c.resolved.pct.toFixed(4) : null,
    commissionSource: c.resolved !== null ? c.resolved.source : null,
    netProfit: c.breakdown !== null ? c.breakdown.netProfit.toFixed(2) : null,
    marginPct:
      c.breakdown !== null && c.breakdown.saleMarginPct !== null
        ? c.breakdown.saleMarginPct.toFixed(2)
        : null,
  };
}

/**
 * Scales a variant's cost aggregate to `n` identical units for the ORDER model: the GROSS-TRY unit
 * cost is multiplied by n (Decimal), a null cost stays null (a missing cost is still missing at any
 * quantity), and every other aggregate field is carried through unchanged so the cost status still
 * gates calculability. `undefined` (no aggregate at all) passes through untouched.
 */
function scaleCostForOrder(
  cost: VariantCostAggregate | undefined,
  n: number,
): VariantCostAggregate | undefined {
  if (cost === undefined || cost.currentCostTry === null) return cost;
  return { ...cost, currentCostTry: new Decimal(cost.currentCostTry).mul(n).toString() };
}

/**
 * ORDER-scope profit breakdown for a single-product basket of `n` identical units (design §11,
 * profit-formula.md §2.4). The order model is n× product cost, 1× shipping, 1× PSF: the cost
 * aggregate is scaled to n while shipping and the platform service stay the econ's FIXED line
 * items, so the engine counts each exactly ONCE per parcel — a basket of n identical units ships as
 * a single parcel, and §2.4 makes the platform service a per-parcel charge. The commission RATE is
 * the scenario's already-resolved band rate (`resolved.pct`, selected from the UNIT price, not the
 * order total); commission gross, stoppage and net VAT then scale with `orderRevenue` (the order's
 * sale gross) through the engine formula, and the net-VAT clamp is handled naturally by the engine
 * (no add-back approximation). Returns null in exactly the cases the unit breakdown is null: no
 * matched variant (`variant` null), no resolved commission (`resolved` null), or missing
 * cost/shipping (a null econ). All arithmetic is Decimal.
 */
export function computeOrderBreakdown(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  resolved: ResolvedDiscountCommission | null,
  n: number,
  orderRevenue: Decimal,
): ProfitBreakdown | null {
  if (variant === null || resolved === null) return null;
  const probe = assembleUnitEconomics(ctx, variant, {
    costAggregate: scaleCostForOrder(cost, n),
    commission: tariffCommission(resolved.pct),
    shipping,
  });
  if (probe.econ === null) return null;
  return computeUnitProfit(probe.econ, orderRevenue);
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

export interface ComputedDiscountEstimate {
  readonly calculable: boolean;
  readonly reason: DiscountItemReason | null;
  readonly commissionPct: string | null;
  readonly commissionSource: DiscountCommissionSource | null;
  readonly breakdown: QuoteBreakdown | null;
}

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
  return {
    calculable: c.calculable,
    reason: c.reason,
    commissionPct: c.resolved !== null ? c.resolved.pct.toFixed(4) : null,
    commissionSource: c.resolved !== null ? c.resolved.source : null,
    breakdown: c.breakdown !== null ? serializeBreakdown(c.breakdown) : null,
  };
}
