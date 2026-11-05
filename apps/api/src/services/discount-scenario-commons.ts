// Scenario primitives for the Indirimler (discount list) screen -- the engine-backed core
// shared by the detail rows, the basket (order) scenario, and the breakdown estimate.
//
// Each screen picks its own commission (the three-tier chain in `discount-math-commons`)
// and hands it to the scenario engine (`@pazarsync/profit`) as the rate the engine applies
// verbatim; no financial math lives here -- `evaluateScreenScenario` owns every formula via
// the engine (feedback_no_frontend_financial_calculation). The marketplace campaign screen
// still runs on the pre-engine assembly (`campaign-scenario-legacy.ts`) until Faz 4B Task 8.
//
// Nothing here knows the discount TYPE: the caller decides which price is the matrah and
// which price selects the band. Type knowledge stays in `discount-math-commons`.

import { Decimal } from 'decimal.js';

import { type ProfitStatement } from '@pazarsync/profit';

import {
  resolveDiscountCommission,
  type DiscountCommissionInputs,
  type DiscountCommissionSource,
  type ResolvedDiscountCommission,
} from './discount-math-commons';
import { quoteBreakdownFromStatement, type QuoteBreakdown } from './product-pricing.service';
import {
  evaluateScreenScenario,
  formatMarginPct2,
  formatMoney2,
  toKurusHalfUp,
  type ScreenScenarioBase,
} from './scenario-screen-commons';
import { type TariffItemReason } from './tariff-compute-commons';

/**
 * Why a priced scenario carries no profit. The tariff trio (`NO_PRODUCT` / `NO_COST` /
 * `NO_SHIPPING`) plus the discount verticals' own `NO_COMMISSION` -- here the commission is
 * RESOLVED (three-tier chain), not supplied by an Excel column, so it can fail on its own.
 */
export type ScenarioItemReason = TariffItemReason | 'NO_COMMISSION';

/** One priced scenario on the wire: the resolved commission + the resulting profit. */
export interface ComputedPriceScenario {
  readonly price: Decimal;
  readonly commissionPct: string | null; // toFixed(4)
  readonly commissionSource: DiscountCommissionSource | null;
  readonly netProfit: string | null; // formatMoney2
  readonly marginPct: string | null; // formatMarginPct2 (stored scale)
}

/** One scenario's resolution: the commission chain result + the engine's profit statement. */
export interface ScenarioCompute {
  readonly resolved: ResolvedDiscountCommission | null;
  readonly calculable: boolean;
  readonly reason: ScenarioItemReason | null;
  readonly statement: ProfitStatement | null;
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
 * Prices ONE scenario with the engine. Resolves the commission at the 2dp band-lookup
 * price `bandPrice` (the price that SELECTS the band -- for list-price-anchored discounts
 * this is the current price, not the displayed discounted price; see `commissionBandPrice`),
 * then evaluates the base at `price` (the MATRAH, the effective revenue) rounded HALF-UP to
 * the kurus (decision 6) under that rate. `quantity` defaults to 1; the basket passes n for
 * the ORDER scope and the engine then prices n cost units, one shipping and one
 * platform-service fee per parcel, and desi x n.
 *
 * Reason order (Task 5 review rule): `degraded` FIRST (reason null, already logged), then
 * no-product (NO_PRODUCT -- the true root cause of an UNMATCHED catalog row, gated before
 * the chain), then an unresolvable commission (NO_COMMISSION), then the evaluation reason
 * (NO_COST / NO_SHIPPING). The band is resolved even on a degraded / no-product base so the
 * row can still surface the rate. The engine may throw on a pathological input (e.g. a
 * negative price) -- that PROPAGATES; the calling service catches it per item.
 */
export function priceScenario(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  readonly price: Decimal;
  readonly bandPrice: Decimal;
  readonly quantity?: number;
}): ScenarioCompute {
  const { base, commission, price, bandPrice } = params;
  const quantity = params.quantity ?? 1;

  // Resolve the band at the 2dp band-lookup price. A full-precision value (e.g. 299.992 from
  // NET %20 on 374.99) must not slip through the 0.01 gap between inclusive 2dp band
  // boundaries -- chain and display must agree. The rate then applies to the matrah `price`.
  const resolved = resolveDiscountCommission(commission, bandPrice.toDecimalPlaces(2));

  if (base.kind === 'degraded') {
    return { resolved, calculable: false, reason: null, statement: null };
  }
  if (base.kind === 'no-product') {
    return { resolved, calculable: false, reason: 'NO_PRODUCT', statement: null };
  }
  if (resolved === null) {
    return { resolved: null, calculable: false, reason: 'NO_COMMISSION', statement: null };
  }

  const outcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: toKurusHalfUp(price),
    commissionPct: resolved.pct,
    quantity,
  });
  if (!outcome.calculable) {
    return { resolved, calculable: false, reason: outcome.reason, statement: null };
  }
  return { resolved, calculable: true, reason: null, statement: outcome.statement };
}

/** The scenario's net profit as a 2dp string (half-up), or null when not calculable. */
export function scenarioNetProfit(c: ScenarioCompute): string | null {
  return c.statement !== null && c.statement.netProfit !== null
    ? formatMoney2(c.statement.netProfit)
    : null;
}

/** The scenario's margin as a 2dp string rendered through the stored scale, or null. */
export function scenarioMarginPct(c: ScenarioCompute): string | null {
  return c.statement !== null ? formatMarginPct2(c.statement.saleMarginPct) : null;
}

/**
 * The scenario's full profit breakdown (4-decimal margins, the quote precision) at
 * `listGross` (the unit price times the quantity, with no seller discount at the scenario
 * level), or null when the scenario is not calculable. Shared by the unit estimate and the
 * order estimate so both read one serializer.
 */
export function scenarioBreakdown(c: ScenarioCompute, listGross: Decimal): QuoteBreakdown | null {
  return c.statement !== null
    ? quoteBreakdownFromStatement({
        statement: c.statement,
        listGross,
        sellerDiscountGross: new Decimal(0),
      })
    : null;
}

/** Serializes a scenario compute to the wire scenario (money 2dp, commission 4dp). */
export function toScenario(price: Decimal, c: ScenarioCompute): ComputedPriceScenario {
  return {
    price,
    commissionPct: c.resolved !== null ? c.resolved.pct.toFixed(4) : null,
    commissionSource: c.resolved !== null ? c.resolved.source : null,
    netProfit: scenarioNetProfit(c),
    marginPct: scenarioMarginPct(c),
  };
}

/**
 * Serializes a scenario compute to the full-breakdown (modal) shape. `breakdown` is passed
 * SEPARATELY rather than read off `c` because an ORDER-scope estimate serializes the n-unit
 * order breakdown while its calculability, reason and commission still come from the UNIT
 * compute -- the two can never disagree that way.
 */
export function toEstimate(
  c: ScenarioCompute,
  breakdown: QuoteBreakdown | null,
): ComputedScenarioEstimate {
  return {
    calculable: c.calculable,
    reason: c.reason,
    commissionPct: c.resolved !== null ? c.resolved.pct.toFixed(4) : null,
    commissionSource: c.resolved !== null ? c.resolved.source : null,
    breakdown,
  };
}
