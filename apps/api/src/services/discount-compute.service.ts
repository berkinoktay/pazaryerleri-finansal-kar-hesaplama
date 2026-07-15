// Per-list discount configuration, narrowed from the DiscountList row by the
// validator's discriminated union. Every V1 kurgu reduces to ONE contract:
// effectiveUnitPrice — the per-unit selling price under the "single-product
// basket at the minimum qualifying quantity + proportional split" assumption
// (design §5.1). The profit engine never learns discount types.

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type ProfitBreakdown } from '@pazarsync/profit';

import { bandForPrice } from './commission-tariff-compute.service';
import type { StoredBand } from './commission-tariff.types';
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

export type DiscountConfig =
  | { readonly type: 'NET'; readonly valueKind: 'AMOUNT' | 'PERCENT'; readonly value: Decimal }
  | {
      readonly type: 'CONDITIONAL_BASKET';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minBasketAmount: Decimal;
    }
  | {
      readonly type: 'CONDITIONAL_QUANTITY';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minQuantity: number;
    }
  | { readonly type: 'BUY_X_PAY_Y'; readonly buyQuantity: number; readonly payQuantity: number }
  | {
      readonly type: 'NTH_PRODUCT';
      readonly valueKind: 'AMOUNT' | 'PERCENT' | 'FIXED_PRICE';
      readonly value: Decimal;
      readonly nthIndex: number;
    }
  | {
      readonly type: 'CODE';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minBasketAmount: Decimal;
    };

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/** price × (1 − pct/100), floored at 0. */
function applyPercent(price: Decimal, pct: Decimal): Decimal {
  return Decimal.max(price.mul(Decimal.sub(1, pct.div(HUNDRED))), ZERO);
}

/** price − amount, floored at 0. */
function applyAmount(price: Decimal, amount: Decimal): Decimal {
  return Decimal.max(price.sub(amount), ZERO);
}

/**
 * The minimum quantity of THIS product whose single-product basket satisfies the
 * min-basket condition. A zero/negative price cannot qualify — the caller guards.
 */
function qualifyingQuantity(price: Decimal, minBasketAmount: Decimal): number {
  return Math.max(minBasketAmount.div(price).ceil().toNumber(), 1);
}

/**
 * Per-unit effective selling price under the single-product-basket assumption
 * (design §5.1). Full-precision Decimal — serialization rounds at the DTO edge.
 */
export function effectiveUnitPrice(price: Decimal, config: DiscountConfig): Decimal {
  if (price.lte(ZERO)) return ZERO;

  switch (config.type) {
    case 'NET':
      return config.valueKind === 'PERCENT'
        ? applyPercent(price, config.value)
        : applyAmount(price, config.value);
    case 'CONDITIONAL_BASKET':
    case 'CODE': {
      if (config.valueKind === 'PERCENT') return applyPercent(price, config.value);
      const n = qualifyingQuantity(price, config.minBasketAmount);
      return applyAmount(price, config.value.div(n));
    }
    case 'CONDITIONAL_QUANTITY':
      return config.valueKind === 'PERCENT'
        ? applyPercent(price, config.value)
        : applyAmount(price, config.value.div(Math.max(config.minQuantity, 1)));
    case 'BUY_X_PAY_Y':
      return price.mul(config.payQuantity).div(config.buyQuantity);
    case 'NTH_PRODUCT': {
      const n = Math.max(config.nthIndex, 1);
      const discountedUnit =
        config.valueKind === 'PERCENT'
          ? applyPercent(price, config.value)
          : config.valueKind === 'AMOUNT'
            ? applyAmount(price, config.value)
            : Decimal.max(config.value, ZERO); // FIXED_PRICE
      return price
        .mul(n - 1)
        .add(discountedUnit)
        .div(n);
    }
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Three-tier commission chain ─────────────────────────────────────────────

/** Üç kademeli zincirin girdileri — kalem başına bir kez kurulur. */
export interface DiscountCommissionInputs {
  readonly bands: ReadonlyArray<StoredBand> | null; // 1. kademe: tarife bandı
  readonly productRate: Decimal | null; // 2. kademe: syncedCommissionRate
  readonly categoryRate: Decimal | null; // 3. kademe: kategori oranı
}
export type DiscountCommissionSource = 'band' | 'product' | 'category';
export interface ResolvedDiscountCommission {
  readonly pct: Decimal;
  readonly source: DiscountCommissionSource;
}

/**
 * Üç kademeli komisyon zinciri (Berkin kararı 2026-07-14): (1) fiyatı kapsayan
 * komisyon tarifesi bandı, (2) ürünün senkronlanan komisyonu, (3) kategori oranı.
 * Bant çözümü VERİLEN fiyattan yapılır — senaryo indirimliyse matrah indirim-sonrası
 * tutardır, yani indirimli fiyat cari fiyattan FARKLI bir banda düşebilir (spec §5.2).
 */
export function resolveDiscountCommission(
  inputs: DiscountCommissionInputs,
  price: Decimal,
): ResolvedDiscountCommission | null {
  if (inputs.bands !== null && inputs.bands.length > 0) {
    const band = bandForPrice(inputs.bands, price);
    if (band !== null) return { pct: new Decimal(band.commissionPct), source: 'band' };
  }
  if (inputs.productRate !== null) return { pct: inputs.productRate, source: 'product' };
  if (inputs.categoryRate !== null) return { pct: inputs.categoryRate, source: 'category' };
  return null;
}

// ─── Per-scenario profit compute ─────────────────────────────────────────────

export type DiscountItemReason = TariffItemReason | 'NO_COMMISSION';

export interface ComputedDiscountScenario {
  readonly price: Decimal;
  readonly commissionPct: string | null; // toFixed(4)
  readonly commissionSource: DiscountCommissionSource | null;
  readonly netProfit: string | null; // toFixed(2)
  readonly marginPct: string | null; // toFixed(2)
}

export interface ComputedDiscountItem {
  readonly calculable: boolean;
  readonly reason: DiscountItemReason | null;
  readonly current: ComputedDiscountScenario;
  readonly discounted: ComputedDiscountScenario;
}

/** One scenario's resolution: the commission chain result + the assembled breakdown. */
interface ScenarioCompute {
  readonly resolved: ResolvedDiscountCommission | null;
  readonly calculable: boolean;
  readonly reason: DiscountItemReason | null;
  readonly breakdown: ProfitBreakdown | null;
}

/**
 * Resolves the commission AT `price` (the band lookup uses this exact price — the
 * load-bearing subtlety: an item's discounted price may land in a different band than
 * its current price), then assembles the variant's econ and runs the engine. Reason
 * order: variant null → NO_PRODUCT (the true root cause of an UNMATCHED catalog row —
 * gated first so it is never masked by an unresolvable commission), then commission null
 * → NO_COMMISSION, then the cost/shipping gate (deriveReason). A matched row's outcome is
 * unaffected by this ordering — it can never hit the NO_PRODUCT branch.
 */
function priceScenario(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  price: Decimal,
): ScenarioCompute {
  const resolved = resolveDiscountCommission(commission, price);
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
 * Computes one discount item's TWO scenarios: `current` at `currentPrice` with the
 * chain resolved at that price, and `discounted` at effectiveUnitPrice(currentPrice,
 * config) with the chain RE-resolved at the discounted price (a lower price can land in
 * a lower band). The item's calculability + reason follow the `current` (baseline)
 * scenario — the "do nothing" state the list row shows.
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
  const current = priceScenario(ctx, variant, cost, shipping, commission, currentPrice);
  const discounted = priceScenario(ctx, variant, cost, shipping, commission, discountedPrice);
  return {
    calculable: current.calculable,
    reason: current.reason,
    current: toScenario(currentPrice, current),
    discounted: toScenario(discountedPrice, discounted),
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
 * Full profit breakdown for ONE discount item at `price` (already chosen by the caller:
 * the current price, or effectiveUnitPrice for the discounted scenario). Resolves the
 * commission chain at that exact price and serializes the breakdown — the same numbers
 * the detail row's matching scenario shows, so the modal never disagrees with the row.
 */
export function computeDiscountEstimate(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  price: Decimal,
): ComputedDiscountEstimate {
  const c = priceScenario(ctx, variant, cost, shipping, commission, price);
  return {
    calculable: c.calculable,
    reason: c.reason,
    commissionPct: c.resolved !== null ? c.resolved.pct.toFixed(4) : null,
    commissionSource: c.resolved !== null ? c.resolved.source : null,
    breakdown: c.breakdown !== null ? serializeBreakdown(c.breakdown) : null,
  };
}
