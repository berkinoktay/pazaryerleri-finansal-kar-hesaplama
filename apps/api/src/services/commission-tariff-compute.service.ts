// Per-band profit computation for the saved Commission Tariffs feature.
//
// This is the ONE place the tariff feature differs from Ürün Fiyatlandırma: the
// commission rate comes from the uploaded Excel BAND, not the category/brand
// rate table. Everything else — cost, shipping, PSF, stoppage, VAT — is resolved
// exactly as `product-pricing.service` does, by REUSING its `assembleUnitEconomics`
// and `computeUnitProfit`. No financial math is re-implemented here.
//
// Strategy: assemble the variant's `UnitEconomics` ONCE (a probe — cost/shipping/
// PSF/VAT are band-invariant), then for each band override only `commissionRate`
// and run the engine at that band's price. A null probe econ means the variant
// is not calculable (no cost or no shipping); every band then reports null profit.

import { Decimal } from 'decimal.js';

import type { Platform, Prisma } from '@pazarsync/db';
import { computeUnitProfit, type EstimateOutcome, type UnitEconomics } from '@pazarsync/profit';

import {
  assembleUnitEconomics,
  type AssemblyInputs,
  type ResolvedFeeDefs,
} from './product-pricing.service';
import type { ResolvedCommissionRate } from './commission-rate-resolver';
import type { VariantCostAggregate } from '../validators/product.validator';
import type { StoredBand } from './commission-tariff.types';

// ─── Why an item cannot be costed (no band profit) ──────────────────────────

export type TariffItemReason = 'NO_PRODUCT' | 'NO_COST' | 'NO_SHIPPING';

// ─── Computed result shapes (serialized — strings, never float) ─────────────

export interface ComputedBandResult {
  readonly key: string;
  /** Band price (GROSS TRY) — band1 the current price, others the threshold. */
  readonly price: string;
  /** Commission FRACTION as stored (e.g. "0.19"). */
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

// The exact variant columns `assembleUnitEconomics` reads (mirrors its private
// `VariantForAssembly`). Supplied by the caller after the barcode → variant join.
export interface TariffVariant {
  readonly id: string;
  readonly stockCode: string;
  readonly barcode: string;
  readonly salePrice: Prisma.Decimal;
  readonly vatRate: number | null;
  readonly isDigital: boolean;
  readonly product: { title: string; categoryId: bigint | null; brandId: bigint | null };
}

export interface TariffAssemblyContext {
  readonly platform: Platform;
  readonly feeDefs: ResolvedFeeDefs;
}

/**
 * Synthesizes the `ResolvedCommissionRate` the pure assembly consumes from a raw
 * percent. The tariff sources its commission from the Excel band, not the rate
 * table, so `ruleSource` / `paymentTermDays` / `segmentApplied` are inert here —
 * `assembleUnitEconomics` reads only `.rate`. Kept explicit (no assertion) so the
 * shape stays in lockstep with the resolver's interface.
 */
function bandCommission(ratePercent: Decimal): ResolvedCommissionRate {
  return { rate: ratePercent, paymentTermDays: 0, ruleSource: 'category', segmentApplied: null };
}

/** A band FRACTION ("0.19") → engine percent (19). */
function bandRatePercent(band: StoredBand): Decimal {
  return new Decimal(band.commissionPct).mul(100);
}

function nullBandResults(bands: ReadonlyArray<StoredBand>): ComputedBandResult[] {
  return bands.map((band) => ({
    key: band.key,
    price: new Decimal(band.threshold).toFixed(2),
    commissionPct: band.commissionPct,
    netProfit: null,
    marginPct: null,
  }));
}

/** Cost gates first (margin/profit would be wrong at cost=0), then shipping. */
function deriveReason(costOk: boolean, shippingOk: boolean): TariffItemReason {
  if (!costOk) return 'NO_COST';
  if (!shippingOk) return 'NO_SHIPPING';
  // Commission is always supplied from the band, so calculability can only fail
  // on cost or shipping; default defensively to NO_COST.
  return 'NO_COST';
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
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
): ComputedItemBands {
  const [firstBand] = bands;
  if (variant === null || firstBand === undefined) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      bands: nullBandResults(bands),
      bestBandKey: null,
    };
  }

  const inputs: AssemblyInputs = {
    costAggregate,
    commission: bandCommission(bandRatePercent(firstBand)),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, inputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      bands: nullBandResults(bands),
      bestBandKey: null,
    };
  }

  const baseEcon: UnitEconomics = probe.econ;
  let bestBandKey: string | null = null;
  let bestProfit: Decimal | null = null;

  const results = bands.map((band): ComputedBandResult => {
    const econ: UnitEconomics = { ...baseEcon, commissionRate: bandRatePercent(band) };
    const breakdown = computeUnitProfit(econ, new Decimal(band.threshold));
    if (bestProfit === null || breakdown.netProfit.gt(bestProfit)) {
      bestProfit = breakdown.netProfit;
      bestBandKey = band.key;
    }
    return {
      key: band.key,
      price: new Decimal(band.threshold).toFixed(2),
      commissionPct: band.commissionPct,
      netProfit: breakdown.netProfit.toFixed(2),
      marginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
    };
  });

  return { calculable: true, reason: null, bands: results, bestBandKey };
}
