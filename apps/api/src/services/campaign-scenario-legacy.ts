// LEGACY: the pre-engine scenario primitives, kept only for the marketplace campaign
// screen until Faz 4B Task 8 moves it to the engine; delete this file in Task 8. A
// verbatim copy of the pre-Task-7 discount-scenario-commons.ts (unit assembly +
// computeUnitProfit). The discount screen now prices with the scenario engine; campaigns
// keep this copy so their behavior stays byte-identical until Task 8.
//
// Senaryo kurma primitifleri — İndirimler (satıcının kurduğu indirimler) ve Kampanyalar
// (Trendyol'un kurguladığı kampanyalar) dikeylerinin ORTAK katmanı.
//
// Terfi gerekçesi (CLAUDE.md, WET+1): bu yardımcılar 2026-07'de yalnız
// `discount-compute.service.ts` içinde yaşıyordu; Kampanyalar ikinci tüketici olarak
// devreye girince tek gerçek kaynağa çekildiler. Kampanyalar'ın kendi compute servisi
// bunları AYNEN kullanır — tek farkı hangi fiyatı matrah olarak geçirdiğidir.
//
// Neden `discount-math-commons.ts` DEĞİL: oradaki fonksiyonlar kasten bağımlılıksız saf
// matematiktir (yalnız decimal.js + komisyon bandı tipi). Buradakiler ise
// `product-pricing.service` (econ kurulumu) ve `tariff-compute-commons` (varyant/bağlam
// tipleri) üzerine oturur; ikisini aynı dosyaya koymak saf modülü kirletirdi.
//
// Bu dosyadaki hiçbir fonksiyon indirim TÜRÜNÜ bilmez: hangi fiyatın matrah, hangisinin
// bant girdisi olduğuna çağıran karar verir. Tür bilgisi `discount-math-commons`'ta kalır.

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type ProfitBreakdown } from '@pazarsync/profit';

import {
  resolveDiscountCommission,
  type DiscountCommissionInputs,
  type DiscountCommissionSource,
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

/**
 * Why a priced scenario carries no profit. The tariff trio (`NO_PRODUCT` / `NO_COST` /
 * `NO_SHIPPING`) plus the discount verticals' own `NO_COMMISSION` — here the commission is
 * RESOLVED (three-tier chain), not supplied by an Excel column, so it can fail on its own.
 */
export type ScenarioItemReason = TariffItemReason | 'NO_COMMISSION';

/** One priced scenario on the wire: the resolved commission + the resulting profit. */
export interface ComputedPriceScenario {
  readonly price: Decimal;
  readonly commissionPct: string | null; // toFixed(4)
  readonly commissionSource: DiscountCommissionSource | null;
  readonly netProfit: string | null; // toFixed(2)
  readonly marginPct: string | null; // toFixed(2)
}

/** One scenario's resolution: the commission chain result + the assembled breakdown. */
export interface ScenarioCompute {
  readonly resolved: ResolvedDiscountCommission | null;
  readonly calculable: boolean;
  readonly reason: ScenarioItemReason | null;
  readonly breakdown: ProfitBreakdown | null;
}

/** The full-breakdown (modal) projection of a scenario compute. */
export interface ComputedScenarioEstimate {
  readonly calculable: boolean;
  readonly reason: ScenarioItemReason | null;
  readonly commissionPct: string | null; // toFixed(4)
  readonly commissionSource: DiscountCommissionSource | null;
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * Resolves the commission at `bandPrice` (the price that SELECTS the band — for list-price-
 * anchored discounts this is the current price, not the displayed discounted price; see
 * `commissionBandPrice`), then assembles the variant's econ and runs the engine on
 * `price` (the MATRAH — the effective revenue, always). Reason order: variant null →
 * NO_PRODUCT (the true root cause of an UNMATCHED catalog row — gated first so it is never
 * masked by an unresolvable commission), then commission null → NO_COMMISSION, then the
 * cost/shipping gate (deriveReason). A matched row's outcome is unaffected by this ordering
 * — it can never hit the NO_PRODUCT branch.
 */
export function priceScenario(
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
export function toScenario(price: Decimal, c: ScenarioCompute): ComputedPriceScenario {
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
 * Serializes a scenario compute to the full-breakdown (modal) shape. `breakdown` is passed
 * SEPARATELY rather than read off `c` because an ORDER-scope estimate serializes the n-unit
 * order breakdown ({@link computeOrderBreakdown}) while its calculability, reason and
 * commission still come from the UNIT compute — the two can never disagree that way.
 */
export function toEstimate(
  c: ScenarioCompute,
  breakdown: ProfitBreakdown | null,
): ComputedScenarioEstimate {
  return {
    calculable: c.calculable,
    reason: c.reason,
    commissionPct: c.resolved !== null ? c.resolved.pct.toFixed(4) : null,
    commissionSource: c.resolved !== null ? c.resolved.source : null,
    breakdown: breakdown !== null ? serializeBreakdown(breakdown) : null,
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
 * ORDER-scope profit breakdown for a single-product basket of `n` identical units (İndirimler
 * design §11, profit-formula.md §2.4). The order model is n× product cost, 1× shipping, 1× PSF: the
 * cost aggregate is scaled to n while shipping and the platform service stay the econ's FIXED line
 * items, so the engine counts each exactly ONCE per parcel — a basket of n identical units ships as
 * a single parcel, and §2.4 makes the platform service a per-parcel charge. The commission RATE is
 * the scenario's already-resolved band rate (`resolved.pct`, selected from the UNIT price, not the
 * order total); commission gross, stoppage and net VAT then scale with `orderRevenue` (the order's
 * sale gross) through the engine formula, and the net-VAT clamp is handled naturally by the engine
 * (no add-back approximation). Returns null in exactly the cases the unit breakdown is null: no
 * matched variant (`variant` null), no resolved commission (`resolved` null), or missing
 * cost/shipping (a null econ). All arithmetic is Decimal.
 *
 * `orderRevenue` is the caller's choice and the two verticals differ there: İndirimler passes what
 * the CUSTOMER pays (there is no funding, so it equals the seller's settlement), Kampanyalar passes
 * the SELLER's settlement total (customer + Trendyol's funded share). Commission and settlement run
 * off the seller's amount, so this parameter is never "the paid total" by definition.
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
