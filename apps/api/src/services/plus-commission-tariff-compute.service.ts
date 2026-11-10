// Profit computation for the saved Plus Commission Tariffs feature.
//
// Like the product commission tariff, this prices a variant with the shared scenario
// engine (`@pazarsync/profit`) and hands it the chosen commission as an override -- no
// financial math is re-implemented. The difference: instead of a 4-band ladder, each
// Plus item has exactly TWO scenarios:
//   • CURRENT — the seller's current price @ their current commission (e.g. 19%).
//   • PLUS    — the Trendyol Plus price CEILING @ the reduced Plus commission
//               (e.g. 15.4%). ALWAYS the ceiling: a committed custom Plus price is
//               a separate what-if that NEVER enters this on-read compute — the
//               offer card is a pure ceiling option. The custom price is written by
//               the export and priced free-form by the estimate endpoint instead.
// The Plus deal requires DROPPING the price to the ceiling to earn the lower
// commission (confirmed from the seller panel), so the value proposition is whether the
// lower ceiling price + lower commission nets more than the status quo — `plusIsBetter`
// compares the CEILING scenario against the current one. Profit is optimistic (a
// what-if), like every estimate here.

import { Decimal } from 'decimal.js';

import {
  evaluateScreenScenario,
  formatMarginPct2,
  formatMoney2,
  type ScreenScenarioBase,
} from './scenario-screen-commons';
import { quoteBreakdownFromStatement, type QuoteBreakdown } from './product-pricing.service';
import { type TariffItemReason } from './tariff-compute-commons';

// ─── Inputs the compute reads off one persisted item ────────────────────────

export interface PlusItemInputs {
  /** Güncel TSF (the seller's current sale price) — echoed on the wire, not priced. */
  readonly currentPrice: Decimal;
  /**
   * Komisyona Esas Fiyat — the customer-seen price commission is charged on. The
   * current ("do nothing") scenario is priced HERE (schema NOT NULL, so there is no
   * sale-price fallback), matching the product commission tariff's #400 semantics.
   */
  readonly commissionBasePrice: Decimal;
  readonly currentCommissionPct: Decimal;
  readonly plusPriceUpperLimit: Decimal;
  readonly plusCommissionPct: Decimal;
}

// ─── Result shapes (serialized — strings, never float) ──────────────────────

export interface ComputedScenario {
  /** Gross sale price (TRY) this scenario is computed at. */
  readonly price: string;
  /** Commission PERCENT as stored (e.g. "19", "15.4"). */
  readonly commissionPct: string;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

/**
 * The "do nothing" baseline: net profit + sale margin at the commission-base price
 * under the current commission. Price + commission are echoed from the item on the
 * wire, so only the computed figures live here — mirrors the product commission
 * tariff's flattened current scenario.
 */
export interface ComputedCurrentScenario {
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

export interface ComputedPlusItem {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly current: ComputedCurrentScenario;
  readonly plus: ComputedScenario;
  /** True when the Plus scenario nets strictly more profit than the current one. */
  readonly plusIsBetter: boolean;
}

const NULL_CURRENT: ComputedCurrentScenario = { netProfit: null, marginPct: null };

function nullScenario(price: Decimal, commissionPct: Decimal): ComputedScenario {
  return {
    price: price.toFixed(2),
    commissionPct: commissionPct.toString(),
    netProfit: null,
    marginPct: null,
  };
}

/**
 * Computes the current + Plus scenarios for one item with the scenario engine. A
 * store-wide load failure (`base` degraded) is checked FIRST: not calculable with a null
 * reason (the caller has already logged it), so a matched item under a store-wide degrade
 * never reports NO_PRODUCT. Otherwise an unmatched barcode (`base` no-product) is not
 * calculable (NO_PRODUCT). Otherwise the CURRENT baseline runs at the commission-base price
 * under the current commission and decides the item's calculability; the PLUS scenario
 * runs at the ceiling (`plusPriceUpperLimit`, ALWAYS -- a committed custom price never
 * enters here) under the reduced commission, both passed to the engine as overrides. The
 * engine may throw on a pathological input -- that propagates to the service, which
 * catches it per item.
 */
export function computePlusItem(params: {
  readonly inputs: PlusItemInputs;
  readonly base: ScreenScenarioBase;
}): ComputedPlusItem {
  const { inputs, base } = params;
  // The Plus offer is ALWAYS priced at the ceiling; a committed custom price is echoed
  // and priced by the estimate endpoint, never read here.
  const pPrice = inputs.plusPriceUpperLimit;

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under a
  // store-wide degrade always reports reason null -- never NO_PRODUCT.
  if (base.kind === 'degraded') {
    return {
      calculable: false,
      reason: null,
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, inputs.plusCommissionPct),
      plusIsBetter: false,
    };
  }

  if (base.kind === 'no-product') {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, inputs.plusCommissionPct),
      plusIsBetter: false,
    };
  }

  // Baseline ("do nothing"): the current commission at the COMMISSION-BASE price — the
  // customer-seen price commission is actually charged on, NOT the sale price. It
  // decides the item's calculability.
  const currentOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: inputs.commissionBasePrice,
    commissionPct: inputs.currentCommissionPct,
  });
  if (!currentOutcome.calculable) {
    return {
      calculable: false,
      reason: currentOutcome.reason,
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, inputs.plusCommissionPct),
      plusIsBetter: false,
    };
  }

  const plusOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: pPrice,
    commissionPct: inputs.plusCommissionPct,
  });

  // plusIsBetter needs BOTH scenarios calculable; a null Plus profit never "wins".
  const plusIsBetter = plusOutcome.calculable && plusOutcome.netProfit.gt(currentOutcome.netProfit);

  return {
    calculable: true,
    reason: null,
    current: {
      netProfit: formatMoney2(currentOutcome.netProfit),
      marginPct: formatMarginPct2(currentOutcome.statement.saleMarginPct),
    },
    plus: {
      price: pPrice.toFixed(2),
      commissionPct: inputs.plusCommissionPct.toString(),
      netProfit: plusOutcome.calculable ? formatMoney2(plusOutcome.netProfit) : null,
      marginPct: plusOutcome.calculable
        ? formatMarginPct2(plusOutcome.statement.saleMarginPct)
        : null,
    },
    plusIsBetter,
  };
}

// ─── Single-price estimate (custom-price what-if under the Plus commission) ──

export interface ComputedPlusEstimate {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  /** The Plus commission percent applied (e.g. "15.4"); null when no variant. */
  readonly commissionPct: string | null;
  /** Full serialized profit breakdown at `price`; null when not calculable. */
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * Computes the full profit breakdown for ONE Plus item at an arbitrary `price` under a
 * GIVEN commission percent (the caller picks the scenario's commission: current or Plus),
 * with the scenario engine. This is the free-form what-if the detail modal drives. Same
 * not-calculable semantics as `computePlusItem`: a store-wide load failure (`base`
 * degraded) is checked FIRST and still echoes the applied percent with a null breakdown
 * (reason null), so a matched item under a store-wide degrade never reports NO_PRODUCT; an
 * unmatched variant (`base` no-product) has a null commission; a not-calculable scenario
 * also echoes the applied percent with a null breakdown.
 */
export function computePlusEstimate(params: {
  readonly applyCommissionPct: Decimal;
  readonly base: ScreenScenarioBase;
  readonly price: Decimal;
}): ComputedPlusEstimate {
  const { applyCommissionPct, base, price } = params;

  const commissionPct = applyCommissionPct.toString();

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under a
  // store-wide degrade reports reason null (never NO_PRODUCT); the applied percent is echoed.
  if (base.kind === 'degraded') {
    return { calculable: false, reason: null, commissionPct, breakdown: null };
  }

  if (base.kind === 'no-product') {
    return { calculable: false, reason: 'NO_PRODUCT', commissionPct: null, breakdown: null };
  }

  const outcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: price,
    commissionPct: applyCommissionPct,
  });
  if (!outcome.calculable) {
    return { calculable: false, reason: outcome.reason, commissionPct, breakdown: null };
  }

  const breakdown = quoteBreakdownFromStatement({ statement: outcome.statement });
  if (breakdown === null) {
    return { calculable: false, reason: null, commissionPct, breakdown: null };
  }

  return { calculable: true, reason: null, commissionPct, breakdown };
}
