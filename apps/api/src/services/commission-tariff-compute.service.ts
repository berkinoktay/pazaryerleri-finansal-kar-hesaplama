// Per-band profit computation for the saved Commission Tariffs feature.
//
// This is the ONE place the tariff feature differs from Ürün Fiyatlandırma: the
// commission rate comes from the uploaded Excel BAND, not the category/brand
// rate table. Everything else — cost, shipping, PSF, stoppage, VAT — is resolved
// exactly as `product-pricing.service` does, by REUSING its `assembleUnitEconomics`
// and `computeUnitProfit`. No financial math is re-implemented here.
//
// Each Trendyol band is a PRICE RANGE [lowerLimit, upperLimit] with its own
// commission (a PERCENT). Profit for a band is computed at the bracket's upper
// limit — the highest price that still earns that commission, i.e. the best
// profit for the tier (optimistic, like every other estimate in the system).
// Band 1 has no upper limit, so the seller's current price applies.
//
// Strategy: assemble the variant's `UnitEconomics` ONCE (a probe — cost/shipping/
// PSF/VAT are band-invariant), then for each band override only `commissionRate`
// and run the engine at that band's price. A null probe econ means the variant is
// not calculable (no cost or no shipping); every band then reports null profit.

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type UnitEconomics } from '@pazarsync/profit';

import {
  assembleUnitEconomics,
  serializeBreakdown,
  type AssemblyInputs,
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
import type { StoredBand } from './commission-tariff.types';

// Re-exported so existing consumers (commission-tariff.service, estimate route)
// keep importing these shared types from here. Their single source is
// `tariff-compute-commons`, shared with the Plus tariff feature.
export type { TariffAssemblyContext, TariffItemReason, TariffVariant };

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

export interface ComputedItemBands {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly bands: ReadonlyArray<ComputedBandResult>;
  /** Key of the band with the highest net profit, or null if none calculable. */
  readonly bestBandKey: string | null;
}

/** A band's representative price: bracket upper limit, or current price for band 1 (no upper). */
function bandPrice(band: StoredBand, currentPrice: Decimal): Decimal {
  return band.upperLimit !== null ? new Decimal(band.upperLimit) : currentPrice;
}

function nullBandResults(
  bands: ReadonlyArray<StoredBand>,
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
 * Computes every band's net profit for one tariff item. `variant` is null for an
 * unmatched barcode → not calculable, reason NO_PRODUCT. Otherwise the variant's
 * econ is probed once; if non-null, each band overrides only `commissionRate` and
 * runs `computeUnitProfit` at the band price.
 */
export function computeItemBands(
  ctx: TariffAssemblyContext,
  bands: ReadonlyArray<StoredBand>,
  currentPrice: Decimal,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
): ComputedItemBands {
  const [firstBand] = bands;
  if (variant === null || firstBand === undefined) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      bands: nullBandResults(bands, currentPrice),
      bestBandKey: null,
    };
  }

  const inputs: AssemblyInputs = {
    costAggregate,
    commission: tariffCommission(new Decimal(firstBand.commissionPct)),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, inputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      bands: nullBandResults(bands, currentPrice),
      bestBandKey: null,
    };
  }

  const baseEcon: UnitEconomics = probe.econ;
  let bestBandKey: string | null = null;
  let bestProfit: Decimal | null = null;

  const results = bands.map((band): ComputedBandResult => {
    const price = bandPrice(band, currentPrice);
    const econ: UnitEconomics = { ...baseEcon, commissionRate: new Decimal(band.commissionPct) };
    const breakdown = computeUnitProfit(econ, price);
    if (bestProfit === null || breakdown.netProfit.gt(bestProfit)) {
      bestProfit = breakdown.netProfit;
      bestBandKey = band.key;
    }
    return {
      key: band.key,
      lowerLimit: band.lowerLimit,
      upperLimit: band.upperLimit,
      price: price.toFixed(2),
      commissionPct: band.commissionPct,
      netProfit: breakdown.netProfit.toFixed(2),
      marginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
    };
  });

  return { calculable: true, reason: null, bands: results, bestBandKey };
}

// ─── Single-price estimate (band-click breakdown + custom-price what-if) ─────

/**
 * Finds the band an arbitrary price falls into. Bands are stored top-down —
 * band1 `[lower, ∞)`, band2/band3 `[lower, upper]`, band4 `(-∞, upper]` — with
 * TOUCHING boundaries (band2's upper equals band1's lower). Iterating in order
 * returns the FIRST containing band, so a price on a shared boundary resolves to
 * the HIGHER band. That is why a band-click must pass an explicit `bandKey`
 * (a band's own upper-limit price would otherwise map to the band above it);
 * only the free-form custom price relies on this lookup. Returns null when no
 * band contains the price (e.g. an item with no bands).
 */
export function bandForPrice(bands: ReadonlyArray<StoredBand>, price: Decimal): StoredBand | null {
  for (const band of bands) {
    const aboveLower = band.lowerLimit === null || price.gte(band.lowerLimit);
    const belowUpper = band.upperLimit === null || price.lte(band.upperLimit);
    if (aboveLower && belowUpper) return band;
  }
  return null;
}

export interface ComputedEstimate {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  /** The band whose commission was applied — echoed (bandKey) or price-derived. */
  readonly bandKey: string | null;
  /** Commission PERCENT of the applied band (e.g. "19"); null when no band. */
  readonly commissionPct: string | null;
  /** Full serialized profit breakdown at `price`; null when not calculable. */
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * Computes the full profit breakdown for ONE tariff item at an arbitrary price.
 * Mirrors `computeItemBands` (same assembly, same not-calculable semantics) but
 * returns a single serialized breakdown for the detail band-click modal and the
 * custom-price what-if. The commission comes from the resolved band: a non-null
 * `bandKey` (band-click) selects it exactly; otherwise the band the price falls
 * into (`bandForPrice`) supplies it. A null variant or no resolvable band is
 * not-calculable with reason `NO_PRODUCT` (matching the detail view).
 */
export function computeItemEstimate(
  ctx: TariffAssemblyContext,
  bands: ReadonlyArray<StoredBand>,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  price: Decimal,
  bandKey: string | null,
): ComputedEstimate {
  const band =
    (bandKey !== null ? bands.find((b) => b.key === bandKey) : undefined) ??
    bandForPrice(bands, price);

  if (variant === null || band === null) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      bandKey: null,
      commissionPct: null,
      breakdown: null,
    };
  }

  const inputs: AssemblyInputs = {
    costAggregate,
    commission: tariffCommission(new Decimal(band.commissionPct)),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, inputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      bandKey: band.key,
      commissionPct: band.commissionPct,
      breakdown: null,
    };
  }

  return {
    calculable: true,
    reason: null,
    bandKey: band.key,
    commissionPct: band.commissionPct,
    breakdown: serializeBreakdown(computeUnitProfit(probe.econ, price)),
  };
}
