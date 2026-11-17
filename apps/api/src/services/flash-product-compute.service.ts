// Per-item profit computation for the Flash Products (Flas Urunler) feature.
//
// Sibling of the Advantage compute service. A flash row has a current baseline plus up
// to two flash OFFERS (a 24-hour window and a 3-hour window), each with its own price.
// The reduced commission is NOT in the Excel: an offer's price is charged the rate of
// the commission-tariff BAND its window resolves into (see flash-product-commission),
// and when no band resolves it keeps the flat "Mevcut Komisyon" (I) rate -- there is NO
// category fallback (the difference from Advantage). Everything else -- cost, shipping,
// PSF, stoppage, VAT -- is resolved by the shared scenario engine (`@pazarsync/profit`):
// the screen picks the band (or flat) rate and hands it to `evaluateScreenScenario` as
// the engine's commission override. No financial math is re-implemented.
//
// Strategy: with a known flat rate the current baseline (customer price @ current
// commission) decides calculability, and an item can only fail on cost or shipping (or an
// unmatched product). Each present offer is evaluated at its own price under its own rate
// and carries profit only when the item is calculable AND the offer's own evaluation is
// calculable.
//
// The flat rate may be unknown (null: the file's "Mevcut Komisyon" cell was blank or
// unreadable). It is never priced at 0%: the current scenario has no profit, an offer
// whose price lands in a band keeps its band rate and profit, and an offer that would fall
// back to the flat rate has no commission and no profit (it is not evaluated). The item is
// then calculable when any offer is. There is still no NO_COMMISSION case: the reason
// vocabulary is the shared `TariffItemReason`, and an unknown rate adds no reason of its own.

import { Decimal } from 'decimal.js';

import {
  storedTariffBandForPrice,
  type StoredTariffBand,
  type TrendyolScenarioBase,
} from '@pazarsync/profit';

import { resolveValidity, type TariffValidity } from '../workbooks/tariff-week';
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

/** Where an offer/estimate commission came from: a covering tariff band, else the flat "Mevcut Komisyon" rate. */
export type FlashCommissionSource = 'band' | 'current';

export interface ResolvedFlashCommission {
  readonly pct: Decimal;
  readonly source: FlashCommissionSource;
}

/**
 * Resolves the commission PERCENT for a price: the band it lands in (of the offer's
 * covering commission-tariff period), else the flat fallback (`flatPct`, the "Mevcut
 * Komisyon" column). Unlike the Advantage vertical there is NO category fallback -- a
 * product with no covering band keeps its current commission. Null when the price lands
 * in no band and the flat percent is unknown (its cell was blank or unreadable): the
 * commission is unknown, never 0.
 */
export function resolveFlashCommission(
  bands: ReadonlyArray<StoredTariffBand> | null,
  flatPct: Decimal | null,
  price: Decimal,
): ResolvedFlashCommission | null {
  if (bands !== null && bands.length > 0) {
    const band = storedTariffBandForPrice(bands, price);
    if (band !== null) return { pct: new Decimal(band.commissionPct), source: 'band' };
  }
  if (flatPct === null) return null;
  return { pct: flatPct, source: 'current' };
}

// --- Per-offer scenario ---

/** One offer window (24h or 3h) resolved for compute: its price, window, and covering bands. */
export interface FlashOfferInput {
  readonly price: Decimal;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** The covering commission-tariff bands for THIS offer's window start, or null (flat). */
  readonly bands: ReadonlyArray<StoredTariffBand> | null;
}

export interface ComputedFlashOffer {
  readonly price: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly validity: TariffValidity | null;
  /**
   * Reduced commission PERCENT applied at this offer (e.g. "11.5000"). Null when no band
   * covers the offer price and the flat rate is unknown; the offer then has no profit.
   */
  readonly commissionPct: string | null;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

/** One built offer plus its own evaluation, so the item can decide calculability. */
interface BuiltFlashOffer {
  readonly offer: ComputedFlashOffer;
  /** The offer's evaluation; null when it was not evaluated (no base, or an unknown commission). */
  readonly outcome: ScreenScenarioOutcome | null;
}

/** An item's two built offer windows; null when the window is absent from the row. */
interface BuiltFlashOffers {
  readonly offer24: BuiltFlashOffer | null;
  readonly offer3: BuiltFlashOffer | null;
}

/**
 * Builds one offer's result: commission resolved from its OWN window bands (else the
 * flat rate), validity from its window, and -- when `base` is non-null and the commission
 * is known -- net profit + margin at the offer price. A null `base` (the item is not
 * calculable), an unknown commission (no band and an unknown flat rate), or an offer whose
 * own evaluation is not calculable still surfaces the price / window / validity /
 * commission (null when unknown) with null profit. An unknown commission is never
 * evaluated.
 */
function buildFlashOffer(
  offer: FlashOfferInput,
  flatPct: Decimal | null,
  now: Date,
  base: TrendyolScenarioBase | null,
): BuiltFlashOffer {
  const resolved = resolveFlashCommission(offer.bands, flatPct, offer.price);
  const outcome =
    base !== null && resolved !== null
      ? evaluateScreenScenario({ base, unitPrice: offer.price, commissionPct: resolved.pct })
      : null;
  const profitable = outcome !== null && outcome.calculable ? outcome : null;
  return {
    offer: {
      price: offer.price.toFixed(2),
      startsAt: offer.startsAt?.toISOString() ?? null,
      endsAt: offer.endsAt?.toISOString() ?? null,
      validity: resolveValidity(offer.startsAt, offer.endsAt, now),
      commissionPct: resolved === null ? null : resolved.pct.toFixed(4),
      netProfit: profitable === null ? null : formatMoney2(profitable.netProfit),
      marginPct: profitable === null ? null : formatMarginPct2(profitable.statement.saleMarginPct),
    },
    outcome,
  };
}

// --- Item compute ---

export interface ComputedFlashItem {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  /**
   * Current-scenario (customerPrice @ currentCommissionPct) profit; null when not
   * calculable or when the current commission is unknown.
   */
  readonly currentNetProfit: string | null;
  readonly currentMarginPct: string | null;
  readonly offer24: ComputedFlashOffer | null;
  readonly offer3: ComputedFlashOffer | null;
  /** Whether the item's PRIMARY window resolved to a band ladder (band) or the flat rate (current). */
  readonly commissionSource: FlashCommissionSource;
  /** The primary window's band ladder, surfaced for the info popover; null on the flat fallback. */
  readonly commissionBands: ReadonlyArray<StoredTariffBand> | null;
}

export interface FlashItemComputeInput {
  /**
   * The "Mevcut Komisyon" percent: the current rate and the flat fallback of an offer no
   * band covers. Null when the file's cell was blank or unreadable.
   */
  readonly currentCommissionPct: Decimal | null;
  readonly customerPrice: Decimal;
  readonly offer24: FlashOfferInput | null;
  readonly offer3: FlashOfferInput | null;
  /** Bands for the primary window (offer24Start ?? offer3Start); drives commissionSource + commissionBands. */
  readonly primaryBands: ReadonlyArray<StoredTariffBand> | null;
}

/**
 * Computes one flash item on read with the scenario engine: the current baseline
 * (customer price @ current commission) plus each present offer (its price @ the
 * commission its window's band supplies, else the flat rate). An unmatched barcode
 * (`base` no-product) -> NO_PRODUCT; a store-wide load failure (`base` degraded) ->
 * reason null (the caller has already logged it); otherwise, with a known flat rate, the
 * current baseline gates on cost/shipping -> NO_COST / NO_SHIPPING (or null on the
 * defensive branch). There is no NO_COMMISSION. Offers are always built (price / window /
 * validity / commission shown) and carry profit only when the item is calculable AND the
 * offer's own evaluation is calculable.
 *
 * An unknown flat rate (null `currentCommissionPct`) has no current scenario: the current
 * profit and margin are null and each present offer stands on its own -- a band offer is
 * evaluated, a flat-fallback offer has a null commission and no profit. The item is
 * calculable when any offer is; otherwise its reason is the first evaluated offer's
 * reason, or null when no offer was evaluated. The engine may throw on a pathological
 * input -- that propagates to the service, which catches it per item.
 */
export function computeFlashItem(params: {
  readonly input: FlashItemComputeInput;
  readonly now: Date;
  readonly base: ScreenScenarioBase;
}): ComputedFlashItem {
  const { input, now, base } = params;

  const commissionSource: FlashCommissionSource =
    input.primaryBands !== null && input.primaryBands.length > 0 ? 'band' : 'current';
  const commissionBands = commissionSource === 'band' ? input.primaryBands : null;

  const buildOffers = (evalBase: TrendyolScenarioBase | null): BuiltFlashOffers => ({
    offer24:
      input.offer24 !== null
        ? buildFlashOffer(input.offer24, input.currentCommissionPct, now, evalBase)
        : null,
    offer3:
      input.offer3 !== null
        ? buildFlashOffer(input.offer3, input.currentCommissionPct, now, evalBase)
        : null,
  });

  const toWire = (built: BuiltFlashOffers): Pick<ComputedFlashItem, 'offer24' | 'offer3'> => ({
    offer24: built.offer24?.offer ?? null,
    offer3: built.offer3?.offer ?? null,
  });

  const uncalculable = (reason: TariffItemReason | null): ComputedFlashItem => ({
    calculable: false,
    reason,
    currentNetProfit: null,
    currentMarginPct: null,
    ...toWire(buildOffers(null)),
    commissionSource,
    commissionBands,
  });

  // Degraded (store-wide load failure, already logged) is checked FIRST, so a matched
  // item under a store-wide degrade reports reason null, never NO_PRODUCT.
  if (base.kind === 'degraded') return uncalculable(null);
  if (base.kind === 'no-product') return uncalculable('NO_PRODUCT');

  // Unknown flat rate: no current scenario (never priced at 0%); the offers decide.
  if (input.currentCommissionPct === null) {
    const built = buildOffers(base.base);
    // Evaluated outcomes in offer order (24h first); a flat-fallback offer is not evaluated.
    const outcomes = [built.offer24, built.offer3].flatMap((b) =>
      b === null || b.outcome === null ? [] : [b.outcome],
    );
    const calculable = outcomes.some((outcome) => outcome.calculable);
    return {
      calculable,
      reason: calculable ? null : outcomeReason(outcomes[0]),
      currentNetProfit: null,
      currentMarginPct: null,
      ...toWire(built),
      commissionSource,
      commissionBands,
    };
  }

  // Current baseline (customer price @ current commission) decides calculability.
  const currentOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: input.customerPrice,
    commissionPct: input.currentCommissionPct,
  });
  if (!currentOutcome.calculable) {
    return uncalculable(currentOutcome.reason);
  }

  return {
    calculable: true,
    reason: null,
    currentNetProfit: formatMoney2(currentOutcome.netProfit),
    currentMarginPct: formatMarginPct2(currentOutcome.statement.saleMarginPct),
    ...toWire(buildOffers(base.base)),
    commissionSource,
    commissionBands,
  };
}

// --- Single-price estimate (custom-price what-if + current scenario) ---

export interface ComputedFlashEstimate {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly commissionPct: string | null;
  readonly commissionSource: FlashCommissionSource | null;
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * How the estimate resolves its commission:
 *   - `resolve`  -- from the item's PRIMARY window bands at the estimate price (the band
 *                  it lands in, else the flat rate) -- the custom-price what-if. `flatPct`
 *                  is null when the file's "Mevcut Komisyon" cell was blank or unreadable.
 *   - `override` -- applied verbatim (the current scenario: customer price @ current
 *                  commission), so the breakdown matches the detail's current baseline.
 *                  Its percent is never null: an unknown current percent has no
 *                  current scenario to estimate.
 */
export type FlashEstimateCommission =
  | {
      readonly kind: 'resolve';
      readonly bands: ReadonlyArray<StoredTariffBand> | null;
      readonly flatPct: Decimal | null;
    }
  | { readonly kind: 'override'; readonly pct: Decimal };

/**
 * The estimate when the price lands in no band and the flat rate is unknown: not
 * calculable, no reason, no commission (never priced at 0%). The source names the flat
 * column the commission would have come from.
 */
const UNKNOWN_FLAT_ESTIMATE: ComputedFlashEstimate = {
  calculable: false,
  reason: null,
  commissionPct: null,
  commissionSource: 'current',
  breakdown: null,
};

/**
 * Full profit breakdown for ONE flash item at `price` with the scenario engine. In
 * `resolve` mode the commission comes from the band the price lands in (else the flat
 * rate); in `override` mode it is applied verbatim (the current scenario). An unmatched
 * variant (`base` no-product) -> NO_PRODUCT; a store-wide load failure (`base` degraded)
 * echoes the resolved commission with a null breakdown and null reason. A price that
 * falls back to an unknown flat rate (matched or degraded base) answers not calculable
 * with a null reason, a null commission and the `current` source; it is never evaluated.
 * Otherwise the scenario is evaluated at `price`: a cost/shipping gate -> NO_COST /
 * NO_SHIPPING (commission echoed), else the 4-decimal-margin breakdown. There is no
 * NO_COMMISSION. Same ordering the detail view uses.
 */
export function computeFlashEstimate(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: FlashEstimateCommission;
  readonly price: Decimal;
}): ComputedFlashEstimate {
  const { base, commission, price } = params;

  const resolved: ResolvedFlashCommission | null =
    commission.kind === 'override'
      ? { pct: commission.pct, source: 'current' }
      : resolveFlashCommission(commission.bands, commission.flatPct, price);

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under
  // a store-wide degrade reports reason null (never NO_PRODUCT). Echo the resolved
  // commission; the breakdown could not be computed.
  if (base.kind === 'degraded') {
    if (resolved === null) return UNKNOWN_FLAT_ESTIMATE;
    return {
      calculable: false,
      reason: null,
      commissionPct: resolved.pct.toFixed(4),
      commissionSource: resolved.source,
      breakdown: null,
    };
  }

  if (base.kind === 'no-product') {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      commissionPct: null,
      commissionSource: null,
      breakdown: null,
    };
  }

  // No band covers the price and the flat rate is unknown: never evaluated at 0%.
  if (resolved === null) return UNKNOWN_FLAT_ESTIMATE;

  const outcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: price,
    commissionPct: resolved.pct,
  });
  if (!outcome.calculable) {
    return {
      calculable: false,
      reason: outcome.reason,
      commissionPct: resolved.pct.toFixed(4),
      commissionSource: resolved.source,
      breakdown: null,
    };
  }

  const breakdown = quoteBreakdownFromStatement({ statement: outcome.statement });
  if (breakdown === null) {
    return {
      calculable: false,
      reason: null,
      commissionPct: resolved.pct.toFixed(4),
      commissionSource: resolved.source,
      breakdown: null,
    };
  }

  return {
    calculable: true,
    reason: null,
    commissionPct: resolved.pct.toFixed(4),
    commissionSource: resolved.source,
    breakdown,
  };
}
