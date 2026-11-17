// Profit computation for the saved Plus Commission Tariffs feature.
//
// Like the product commission tariff, this prices a variant with the shared scenario
// engine (`@pazarsync/profit`) and hands it the chosen commission as an override -- no
// financial math is re-implemented. The difference: instead of a 4-band ladder, each
// Plus item has exactly TWO scenarios:
//   • CURRENT — the commission base price (else the current sale price) @ the
//               seller's current commission (e.g. 19%).
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
//
// A price the file did not give (blank, unreadable or 0) arrives as null and is never
// priced: an unknown baseline (commission base price, else current price) leaves the
// current figures null, and an unknown ceiling leaves the offer with a null price and no
// profit. A commission percent the file did not give (blank or unreadable) arrives as null
// the same way and is never priced, never at 0% (a readable 0 is a real 0% and is priced):
// an unknown current percent leaves the current figures null, and an unknown Plus percent
// leaves the offer with a null commission and no profit. So the current scenario is known
// only when its baseline price AND its percent are, and the offer only when its ceiling AND
// its percent are. `plusIsBetter` needs both profits, so it is false whenever either
// scenario is unknown.

import { Decimal } from 'decimal.js';

import {
  evaluateScreenScenario,
  formatMarginPct2,
  formatMoney2,
  outcomeReason,
  type ScreenScenarioBase,
  type ScreenScenarioOutcome,
} from './scenario-screen-commons';
import { quoteBreakdownFromStatement, type QuoteBreakdown } from './product-pricing.service';
import { type TariffItemReason } from './tariff-compute-commons';

// ─── Inputs the compute reads off one persisted item ────────────────────────

export interface PlusItemInputs {
  /**
   * Current sale price. Priced only as the fallback baseline when the commission base
   * price is unknown; null when the file's cell was blank, unreadable or 0.
   */
  readonly currentPrice: Decimal | null;
  /**
   * Commission base price: the customer-seen price commission is charged on. The current
   * ("do nothing") scenario is priced here when it is known, else at `currentPrice`,
   * matching the product commission tariff's baseline. Null when the file's cell was
   * blank, unreadable or 0.
   */
  readonly commissionBasePrice: Decimal | null;
  /**
   * Current commission percent the baseline is priced under; null when the file's cell was
   * blank or unreadable, and then the current scenario is never priced. A readable 0 is a
   * real 0%.
   */
  readonly currentCommissionPct: Decimal | null;
  /**
   * Plus price ceiling the offer is priced at; null when the file's cell was blank,
   * unreadable or 0, and then the offer is never priced.
   */
  readonly plusPriceUpperLimit: Decimal | null;
  /**
   * Plus commission offer percent the offer is priced under; null when the file's cell was
   * blank or unreadable, and then the offer is never priced. A readable 0 is a real 0%.
   */
  readonly plusCommissionPct: Decimal | null;
}

// ─── Result shapes (serialized — strings, never float) ──────────────────────

export interface ComputedScenario {
  /** Gross sale price (TRY) this scenario is computed at; null when the price is unknown. */
  readonly price: string | null;
  /** Commission PERCENT as stored (e.g. "19", "15.4"); null when the percent is unknown. */
  readonly commissionPct: string | null;
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

/**
 * An offer with no profit; its price is null when the ceiling is unknown and its percent
 * is null when the Plus commission is unknown.
 */
function nullScenario(price: Decimal | null, commissionPct: Decimal | null): ComputedScenario {
  return {
    price: price === null ? null : price.toFixed(2),
    commissionPct: commissionPct === null ? null : commissionPct.toString(),
    netProfit: null,
    marginPct: null,
  };
}

/**
 * The offer evaluated at a known `price` under a known percent; profit and margin only when
 * it is calculable.
 */
function evaluatedScenario(
  price: Decimal,
  commissionPct: Decimal,
  outcome: ScreenScenarioOutcome,
): ComputedScenario {
  return {
    price: price.toFixed(2),
    commissionPct: commissionPct.toString(),
    netProfit: outcome.calculable ? formatMoney2(outcome.netProfit) : null,
    marginPct: outcome.calculable ? formatMarginPct2(outcome.statement.saleMarginPct) : null,
  };
}

/**
 * Computes the current + Plus scenarios for one item with the scenario engine. A
 * store-wide load failure (`base` degraded) is checked FIRST: not calculable with a null
 * reason (the caller has already logged it), so a matched item under a store-wide degrade
 * never reports NO_PRODUCT. Otherwise an unmatched barcode (`base` no-product) is not
 * calculable (NO_PRODUCT). Otherwise the CURRENT baseline runs at the commission-base price
 * (else the current price) under the current commission and decides the item's
 * calculability; the PLUS scenario runs at the ceiling (`plusPriceUpperLimit`, ALWAYS -- a
 * committed custom price never enters here) under the reduced commission, both passed to
 * the engine as overrides.
 *
 * The current scenario is known when its baseline price AND the current percent are known;
 * the offer is known when its ceiling AND the Plus percent are known. An unknown (null)
 * price or percent is never priced, and never priced at 0% (a known 0 is a real 0%):
 *   - current known, offer unknown: the current figures as usual (the current outcome
 *     decides calculability); the offer echoes its price and percent (each null when
 *     unknown) with no profit, not evaluated;
 *   - current unknown, offer known: null current figures; the offer is evaluated at the
 *     ceiling under the Plus percent and alone decides calculability (its reason when not
 *     calculable);
 *   - both unknown: not calculable with a null reason, no profit; the offer still echoes
 *     its price and percent.
 * `plusIsBetter` is false whenever either scenario is unknown. The engine may throw on a
 * pathological input -- that propagates to the service, which catches it per item.
 */
export function computePlusItem(params: {
  readonly inputs: PlusItemInputs;
  readonly base: ScreenScenarioBase;
}): ComputedPlusItem {
  const { inputs, base } = params;
  // The Plus offer is ALWAYS priced at the ceiling; a committed custom price is echoed
  // and priced by the estimate endpoint, never read here. Null when the ceiling is unknown.
  const pPrice = inputs.plusPriceUpperLimit;
  // The Plus commission offer; null when the file's cell was blank or unreadable.
  const pPct = inputs.plusCommissionPct;

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under a
  // store-wide degrade always reports reason null -- never NO_PRODUCT.
  if (base.kind === 'degraded') {
    return {
      calculable: false,
      reason: null,
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, pPct),
      plusIsBetter: false,
    };
  }

  if (base.kind === 'no-product') {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, pPct),
      plusIsBetter: false,
    };
  }

  // Baseline ("do nothing"): the current commission at the COMMISSION-BASE price -- the
  // customer-seen price commission is actually charged on -- else at the current sale
  // price. Null when neither is known.
  const baseline = inputs.commissionBasePrice ?? inputs.currentPrice;
  // The current commission; null when the file's cell was blank or unreadable.
  const currentPct = inputs.currentCommissionPct;

  if (baseline === null || currentPct === null) {
    // No price or no percent to compute the current figures from. A known offer is still
    // evaluated and alone decides calculability; with no current profit, Plus is never
    // "better".
    if (pPrice === null || pPct === null) {
      return {
        calculable: false,
        reason: null,
        current: NULL_CURRENT,
        plus: nullScenario(pPrice, pPct),
        plusIsBetter: false,
      };
    }
    const offerOutcome = evaluateScreenScenario({
      base: base.base,
      unitPrice: pPrice,
      commissionPct: pPct,
    });
    return {
      calculable: offerOutcome.calculable,
      reason: outcomeReason(offerOutcome),
      current: NULL_CURRENT,
      plus: evaluatedScenario(pPrice, pPct, offerOutcome),
      plusIsBetter: false,
    };
  }

  // A known current scenario decides the item's calculability.
  const currentOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: baseline,
    commissionPct: currentPct,
  });
  if (!currentOutcome.calculable) {
    return {
      calculable: false,
      reason: currentOutcome.reason,
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, pPct),
      plusIsBetter: false,
    };
  }

  const current: ComputedCurrentScenario = {
    netProfit: formatMoney2(currentOutcome.netProfit),
    marginPct: formatMarginPct2(currentOutcome.statement.saleMarginPct),
  };

  // An unknown offer (ceiling or percent) is never evaluated: it echoes its price and
  // percent, each null when unknown, with no profit.
  if (pPrice === null || pPct === null) {
    return {
      calculable: true,
      reason: null,
      current,
      plus: nullScenario(pPrice, pPct),
      plusIsBetter: false,
    };
  }

  const plusOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: pPrice,
    commissionPct: pPct,
  });

  // plusIsBetter needs BOTH scenarios calculable; a null Plus profit never "wins".
  const plusIsBetter = plusOutcome.calculable && plusOutcome.netProfit.gt(currentOutcome.netProfit);

  return {
    calculable: true,
    reason: null,
    current,
    plus: evaluatedScenario(pPrice, pPct, plusOutcome),
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
