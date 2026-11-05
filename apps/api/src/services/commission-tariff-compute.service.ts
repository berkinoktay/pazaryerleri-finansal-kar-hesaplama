// Per-band profit computation for the saved Commission Tariffs feature.
//
// This is the ONE place the tariff feature differs from Urun Fiyatlandirma: the
// commission rate comes from the uploaded Excel BAND, not the category/brand rate
// chain. Everything else -- cost, shipping, PSF, stoppage, VAT -- is resolved by the
// shared scenario engine (`@pazarsync/profit`): the screen picks the band price and
// rate, and hands the rate to `evaluateScreenScenario` as the engine's commission
// override. No financial math is re-implemented here.
//
// Each Trendyol band is a PRICE RANGE [lowerLimit, upperLimit] with its own commission
// (a PERCENT). Profit for a band is computed at the bracket's upper limit -- the highest
// price that still earns that commission, i.e. the best profit for the tier (optimistic,
// like every other estimate in the system). Band 1 has no upper limit, so the seller's
// current price applies.
//
// Strategy: the item's CURRENT baseline (the commission-base price at the current rate)
// decides calculability -- when it is not calculable, every band reports null profit
// (legacy all-or-none). Otherwise each band is evaluated at its own price under its own
// stored rate.

import { Decimal } from 'decimal.js';

import { storedTariffBandForPrice, type StoredTariffBand } from '@pazarsync/profit';

import {
  evaluateScreenScenario,
  formatMarginPct2,
  formatMoney2,
  toKurusHalfUp,
  type ScreenScenarioBase,
} from './scenario-screen-commons';
import { quoteBreakdownFromStatement, type QuoteBreakdown } from './product-pricing.service';
import { type TariffItemReason } from './tariff-compute-commons';

// Re-exported so existing consumers keep importing the shared wire reason from here.
export type { TariffItemReason };

// ─── Computed result shapes (serialized — strings, never float) ─────────────

export interface ComputedBandResult {
  readonly key: string;
  readonly lowerLimit: string | null;
  readonly upperLimit: string | null;
  /** Band price (GROSS TRY) — the bracket upper limit, or current price for band 1. */
  readonly price: string;
  /** Commission PERCENT as stored (e.g. "19", "13.1"). */
  readonly commissionPct: string;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

/**
 * The "do nothing" baseline: profit at the commission-base price (the customer-seen
 * price commission is charged on) + current (regular) commission. Falls back to the
 * sale price when the commission-base price is absent (imports predating the column).
 */
export interface ComputedCurrentScenario {
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

export interface ComputedItemBands {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly bands: ReadonlyArray<ComputedBandResult>;
  /** Key of the band with the highest net profit, or null if none calculable. */
  readonly bestBandKey: string | null;
  /**
   * Profit at the commission-base price (customer-seen price, or the sale price when
   * the column is absent) + current commission — the baseline the band/custom "vs
   * current" delta compares against. Null when not calculable.
   */
  readonly current: ComputedCurrentScenario;
}

const NULL_CURRENT: ComputedCurrentScenario = { netProfit: null, marginPct: null };

/**
 * A band's representative price = the boundary the seller SEES in that column: the upper
 * limit for the bounded bands (2-4, "X ve altı"), else the LOWER limit for the open-topped
 * band 1 ("X ve üzeri" — the cheapest price still in the top band). Trendyol's own panel
 * pins the price-update field to exactly this boundary regardless of the current price, and
 * the band's shown profit is computed at it — so selection, profit, and export all use one
 * number. currentPrice is only a defensive fallback for a band with neither limit.
 */
export function bandPrice(band: StoredTariffBand, currentPrice: Decimal): Decimal {
  if (band.upperLimit !== null) return new Decimal(band.upperLimit);
  if (band.lowerLimit !== null) return new Decimal(band.lowerLimit);
  return currentPrice;
}

function nullBandResults(
  bands: ReadonlyArray<StoredTariffBand>,
  currentPrice: Decimal,
): ComputedBandResult[] {
  return bands.map((band) => ({
    key: band.key,
    lowerLimit: band.lowerLimit,
    upperLimit: band.upperLimit,
    price: bandPrice(band, currentPrice).toFixed(2),
    commissionPct: band.commissionPct,
    netProfit: null,
    marginPct: null,
  }));
}

/**
 * Computes every band's net profit for one tariff item with the scenario engine. A
 * store-wide load failure (`base` degraded) is checked FIRST: the empty shape with a null
 * reason (the caller has already logged it), so a matched item under a store-wide degrade
 * always reports null -- never NO_PRODUCT, even with no bands. Otherwise an unmatched
 * barcode (`base` no-product) or an item with no bands is not calculable with reason
 * NO_PRODUCT and every band null (legacy all-or-none).
 *
 * For a ready base the CURRENT baseline is evaluated at `commissionBasePrice ?? currentPrice`
 * under `currentCommissionPct`; it decides the item's calculability all-or-none (so a
 * missing cost drops every band). Then each band is evaluated at its own `bandPrice`
 * under its stored rate (the screen's choice, passed to the engine as an override). A
 * band whose own evaluation is not calculable (rare, price-dependent shipping) shows null
 * profit and is skipped for `bestBandKey`, which is the highest net profit (first wins on
 * ties). The engine may throw on a pathological input -- that propagates to the service,
 * which catches it per item.
 */
export function computeItemBands(params: {
  readonly bands: readonly StoredTariffBand[];
  readonly currentPrice: Decimal;
  readonly commissionBasePrice: Decimal | null;
  readonly currentCommissionPct: Decimal;
  readonly base: ScreenScenarioBase;
}): ComputedItemBands {
  const { bands, currentPrice, commissionBasePrice, currentCommissionPct, base } = params;
  const [firstBand] = bands;

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under a
  // store-wide degrade always reports reason null -- never NO_PRODUCT, even with no bands.
  if (base.kind === 'degraded') {
    return {
      calculable: false,
      reason: null,
      bands: nullBandResults(bands, currentPrice),
      bestBandKey: null,
      current: NULL_CURRENT,
    };
  }

  // No bands, or an unmatched barcode: not calculable, every band null (legacy).
  if (firstBand === undefined || base.kind === 'no-product') {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      bands: nullBandResults(bands, currentPrice),
      bestBandKey: null,
      current: NULL_CURRENT,
    };
  }

  // Baseline ("do nothing"): the current commission at the commission-base price (the
  // customer-seen price commission is actually charged on), falling back to the sale
  // price for imports predating the column. It decides the item's calculability.
  const currentOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: commissionBasePrice ?? currentPrice,
    commissionPct: currentCommissionPct,
  });
  if (!currentOutcome.calculable) {
    return {
      calculable: false,
      reason: currentOutcome.reason,
      bands: nullBandResults(bands, currentPrice),
      bestBandKey: null,
      current: NULL_CURRENT,
    };
  }

  const current: ComputedCurrentScenario = {
    netProfit: formatMoney2(currentOutcome.netProfit),
    marginPct: formatMarginPct2(currentOutcome.statement.saleMarginPct),
  };

  let bestBandKey: string | null = null;
  let bestProfit: Decimal | null = null;

  const results = bands.map((band): ComputedBandResult => {
    const price = bandPrice(band, currentPrice);
    // An imported band limit can carry sub-kurus precision (e.g. "149.999"); the engine
    // rejects a unit price with more than two decimals, so round it to the kurus half-up
    // before evaluating -- exactly as the discount/campaign screens do. The wire `price`
    // below keeps its own `toFixed(2)` (the identical value).
    const outcome = evaluateScreenScenario({
      base: base.base,
      unitPrice: toKurusHalfUp(price),
      commissionPct: new Decimal(band.commissionPct),
    });
    if (outcome.calculable && (bestProfit === null || outcome.netProfit.gt(bestProfit))) {
      bestProfit = outcome.netProfit;
      bestBandKey = band.key;
    }
    return {
      key: band.key,
      lowerLimit: band.lowerLimit,
      upperLimit: band.upperLimit,
      price: price.toFixed(2),
      commissionPct: band.commissionPct,
      netProfit: outcome.calculable ? formatMoney2(outcome.netProfit) : null,
      marginPct: outcome.calculable ? formatMarginPct2(outcome.statement.saleMarginPct) : null,
    };
  });

  return { calculable: true, reason: null, bands: results, bestBandKey, current };
}

// ─── Single-price estimate (band-click breakdown + custom-price what-if) ─────

export interface ComputedEstimate {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  /** The band whose commission was applied — echoed (bandKey) or price-derived; null in override mode. */
  readonly bandKey: string | null;
  /** Commission PERCENT applied (e.g. "19"); null when no band / no variant. */
  readonly commissionPct: string | null;
  /** Full serialized profit breakdown at `price`; null when not calculable. */
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * How the estimate resolves its commission:
 *   - `band`    — from the tariff bands: a non-null `bandKey` selects that band
 *                 exactly (band-click); otherwise the band the price falls into
 *                 (`storedTariffBandForPrice`) supplies it (custom-price what-if).
 *   - `override` — supplied directly (the current scenario), so NO band lookup
 *                 happens; the rate is applied verbatim.
 */
export type EstimateCommission =
  | { readonly kind: 'band'; readonly bandKey: string | null }
  | { readonly kind: 'override'; readonly commissionPct: Decimal };

const NO_PRODUCT_ESTIMATE: ComputedEstimate = {
  calculable: false,
  reason: 'NO_PRODUCT',
  bandKey: null,
  commissionPct: null,
  breakdown: null,
};

/** The commission a non-override estimate applies: its rate plus the band key + stored string it echoes. */
interface ResolvedEstimateCommission {
  readonly rate: Decimal;
  readonly bandKey: string | null;
  readonly commissionPct: string;
}

/**
 * Resolves the commission an estimate applies. Override mode echoes the given rate with
 * no band. Band mode selects the explicit `bandKey`, else the band the price falls into
 * (`storedTariffBandForPrice`); a band mode with no resolvable band returns null, which
 * the caller maps to NO_PRODUCT (matching the detail view).
 */
function resolveEstimateCommission(
  bands: readonly StoredTariffBand[],
  price: Decimal,
  commission: EstimateCommission,
): ResolvedEstimateCommission | null {
  if (commission.kind === 'override') {
    return {
      rate: commission.commissionPct,
      bandKey: null,
      commissionPct: commission.commissionPct.toString(),
    };
  }
  const band =
    (commission.bandKey !== null ? bands.find((b) => b.key === commission.bandKey) : undefined) ??
    storedTariffBandForPrice(bands, price);
  if (band === null) {
    return null;
  }
  return {
    rate: new Decimal(band.commissionPct),
    bandKey: band.key,
    commissionPct: band.commissionPct,
  };
}

/**
 * Computes the full profit breakdown for ONE tariff item at `price` with the scenario
 * engine. Mirrors `computeItemBands` (same engine, same not-calculable semantics) but
 * returns a single serialized breakdown (4-decimal margins) for the detail band-click
 * modal, the custom-price what-if, and the current-scenario breakdown. The commission
 * comes from `commission` (band or override). A store-wide load failure (`base` degraded)
 * is checked FIRST: it echoes the resolved band/commission (null when unresolvable) with a
 * null breakdown and null reason, so a matched item under a store-wide degrade never
 * reports NO_PRODUCT. Otherwise an unmatched variant (`base` no-product), or in band mode
 * no resolvable band, is not-calculable with reason NO_PRODUCT.
 */
export function computeItemEstimate(params: {
  readonly bands: readonly StoredTariffBand[];
  readonly base: ScreenScenarioBase;
  readonly price: Decimal;
  readonly commission: EstimateCommission;
}): ComputedEstimate {
  const { bands, base, price, commission } = params;

  const resolved = resolveEstimateCommission(bands, price, commission);

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under a
  // store-wide degrade reports reason null (never NO_PRODUCT). Echo the resolved
  // band/commission (null when unresolvable); the breakdown could not be computed.
  if (base.kind === 'degraded') {
    return {
      calculable: false,
      reason: null,
      bandKey: resolved?.bandKey ?? null,
      commissionPct: resolved?.commissionPct ?? null,
      breakdown: null,
    };
  }

  // An unmatched barcode is NO_PRODUCT regardless of mode.
  if (base.kind === 'no-product') {
    return NO_PRODUCT_ESTIMATE;
  }

  // Band mode with no resolvable band: NO_PRODUCT (matching the detail view).
  if (resolved === null) {
    return NO_PRODUCT_ESTIMATE;
  }

  const outcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: price,
    commissionPct: resolved.rate,
  });
  if (!outcome.calculable) {
    return {
      calculable: false,
      reason: outcome.reason,
      bandKey: resolved.bandKey,
      commissionPct: resolved.commissionPct,
      breakdown: null,
    };
  }

  const breakdown = quoteBreakdownFromStatement({
    statement: outcome.statement,
    listGross: price,
    sellerDiscountGross: new Decimal(0),
  });
  if (breakdown === null) {
    return {
      calculable: false,
      reason: null,
      bandKey: resolved.bandKey,
      commissionPct: resolved.commissionPct,
      breakdown: null,
    };
  }

  return {
    calculable: true,
    reason: null,
    bandKey: resolved.bandKey,
    commissionPct: resolved.commissionPct,
    breakdown,
  };
}
