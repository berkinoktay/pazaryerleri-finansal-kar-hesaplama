// Per-item profit computation for the Flash Products (Flaş Ürünler) feature.
//
// Sibling of the Advantage compute service. A flash row has a current baseline plus up
// to two flash OFFERS (a 24-hour window and a 3-hour window), each with its own price.
// The reduced commission is NOT in the Excel: an offer's price is charged the rate of
// the commission-tariff BAND its window resolves into (see flash-product-commission),
// and when no band resolves it keeps the flat "Mevcut Komisyon" (I) rate — there is NO
// category fallback (the difference from Advantage). Everything else — cost, shipping,
// PSF, stoppage, VAT — is resolved exactly as Ürün Fiyatlandırma does, by REUSING
// `assembleUnitEconomics` + `computeUnitProfit`. No financial math is re-implemented.
//
// Strategy mirrors the other tariff computes: assemble the variant's econ ONCE (a
// probe — commission-invariant), then per scenario override only `commissionRate` and
// run the engine at that scenario's price. Since the flat rate always resolves, an
// item can only fail on cost or shipping (or an unmatched product) — there is no
// NO_COMMISSION case, so the reason vocabulary is the shared `TariffItemReason`.

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type UnitEconomics } from '@pazarsync/profit';

import { resolveValidity, type TariffValidity } from '../lib/tariff-period';
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

export type { TariffAssemblyContext, TariffItemReason, TariffVariant };

/** Where an offer/estimate commission came from: a covering tariff band, else the flat "Mevcut Komisyon" rate. */
export type FlashCommissionSource = 'band' | 'current';

export interface ResolvedFlashCommission {
  readonly pct: Decimal;
  readonly source: FlashCommissionSource;
}

/**
 * Resolves the commission PERCENT for a price: the band it lands in (of the offer's
 * covering commission-tariff period), else the flat fallback (`flatPct`, the "Mevcut
 * Komisyon" column). Unlike the Advantage vertical there is NO category fallback — a
 * product with no covering band keeps its current commission.
 */
export function resolveFlashCommission(
  bands: ReadonlyArray<StoredBand> | null,
  flatPct: Decimal,
  price: Decimal,
): ResolvedFlashCommission {
  if (bands !== null && bands.length > 0) {
    const band = bandForPrice(bands, price);
    if (band !== null) return { pct: new Decimal(band.commissionPct), source: 'band' };
  }
  return { pct: flatPct, source: 'current' };
}

// ─── Per-offer scenario ──────────────────────────────────────────────────────

/** One offer window (24h or 3h) resolved for compute: its price, window, and covering bands. */
export interface FlashOfferInput {
  readonly price: Decimal;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** The covering commission-tariff bands for THIS offer's window start, or null (flat). */
  readonly bands: ReadonlyArray<StoredBand> | null;
}

export interface ComputedFlashOffer {
  readonly price: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly validity: TariffValidity | null;
  /** Reduced commission PERCENT applied at this offer (e.g. "11.5000"). */
  readonly commissionPct: string;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

/**
 * Builds one offer's result: commission resolved from its OWN window bands (else the
 * flat rate), validity from its window, and — when `baseEcon` is non-null (the item is
 * calculable) — net profit + margin at the offer price. An uncalculable item still
 * surfaces the price / window / validity / commission with null profit.
 */
function buildFlashOffer(
  offer: FlashOfferInput,
  flatPct: Decimal,
  now: Date,
  baseEcon: UnitEconomics | null,
): ComputedFlashOffer {
  const { pct } = resolveFlashCommission(offer.bands, flatPct, offer.price);
  let netProfit: string | null = null;
  let marginPct: string | null = null;
  if (baseEcon !== null) {
    const breakdown = computeUnitProfit({ ...baseEcon, commissionRate: pct }, offer.price);
    netProfit = breakdown.netProfit.toFixed(2);
    marginPct = breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null;
  }
  return {
    price: offer.price.toFixed(2),
    startsAt: offer.startsAt?.toISOString() ?? null,
    endsAt: offer.endsAt?.toISOString() ?? null,
    validity: resolveValidity(offer.startsAt, offer.endsAt, now),
    commissionPct: pct.toFixed(4),
    netProfit,
    marginPct,
  };
}

// ─── Item compute ────────────────────────────────────────────────────────────

export interface ComputedFlashItem {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  /** Current-scenario (customerPrice @ currentCommissionPct) profit; null when not calculable. */
  readonly currentNetProfit: string | null;
  readonly currentMarginPct: string | null;
  readonly offer24: ComputedFlashOffer | null;
  readonly offer3: ComputedFlashOffer | null;
  /** Whether the item's PRIMARY window resolved to a band ladder (band) or the flat rate (current). */
  readonly commissionSource: FlashCommissionSource;
  /** The primary window's band ladder, surfaced for the ⓘ popover; null on the flat fallback. */
  readonly commissionBands: ReadonlyArray<StoredBand> | null;
}

export interface FlashItemComputeInput {
  readonly currentCommissionPct: Decimal;
  readonly customerPrice: Decimal;
  readonly offer24: FlashOfferInput | null;
  readonly offer3: FlashOfferInput | null;
  /** Bands for the primary window (offer24Start ?? offer3Start); drives commissionSource + commissionBands. */
  readonly primaryBands: ReadonlyArray<StoredBand> | null;
}

/**
 * Computes one flash item on read: the current baseline (customer price @ current
 * commission) plus each present offer (its price @ the commission its window's band
 * supplies, else the flat rate). `variant` null → NO_PRODUCT; a null probe econ →
 * NO_COST / NO_SHIPPING. There is no NO_COMMISSION — the flat rate always resolves.
 */
export function computeFlashItem(
  ctx: TariffAssemblyContext,
  input: FlashItemComputeInput,
  now: Date,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
): ComputedFlashItem {
  const commissionSource: FlashCommissionSource =
    input.primaryBands !== null && input.primaryBands.length > 0 ? 'band' : 'current';
  const commissionBands = commissionSource === 'band' ? input.primaryBands : null;

  const buildOffers = (
    baseEcon: UnitEconomics | null,
  ): Pick<ComputedFlashItem, 'offer24' | 'offer3'> => ({
    offer24:
      input.offer24 !== null
        ? buildFlashOffer(input.offer24, input.currentCommissionPct, now, baseEcon)
        : null,
    offer3:
      input.offer3 !== null
        ? buildFlashOffer(input.offer3, input.currentCommissionPct, now, baseEcon)
        : null,
  });

  const uncalculable = (reason: TariffItemReason): ComputedFlashItem => ({
    calculable: false,
    reason,
    currentNetProfit: null,
    currentMarginPct: null,
    ...buildOffers(null),
    commissionSource,
    commissionBands,
  });

  if (variant === null) return uncalculable('NO_PRODUCT');

  const probe = assembleUnitEconomics(ctx, variant, {
    costAggregate,
    commission: tariffCommission(new Decimal(0)),
    shipping,
  });
  if (probe.econ === null) {
    return uncalculable(deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'));
  }

  const baseEcon: UnitEconomics = probe.econ;
  const currentBreakdown = computeUnitProfit(
    { ...baseEcon, commissionRate: input.currentCommissionPct },
    input.customerPrice,
  );

  return {
    calculable: true,
    reason: null,
    currentNetProfit: currentBreakdown.netProfit.toFixed(2),
    currentMarginPct:
      currentBreakdown.saleMarginPct !== null ? currentBreakdown.saleMarginPct.toFixed(2) : null,
    ...buildOffers(baseEcon),
    commissionSource,
    commissionBands,
  };
}

// ─── Single-price estimate (custom-price what-if + current scenario) ─────────

export interface ComputedFlashEstimate {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly commissionPct: string | null;
  readonly commissionSource: FlashCommissionSource | null;
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * How the estimate resolves its commission:
 *   - `resolve`  — from the item's PRIMARY window bands at the estimate price (the band
 *                  it lands in, else the flat rate) — the custom-price what-if.
 *   - `override` — applied verbatim (the current scenario: customer price @ current
 *                  commission), so the breakdown matches the detail's current baseline.
 */
export type FlashEstimateCommission =
  | {
      readonly kind: 'resolve';
      readonly bands: ReadonlyArray<StoredBand> | null;
      readonly flatPct: Decimal;
    }
  | { readonly kind: 'override'; readonly pct: Decimal };

/**
 * Full profit breakdown for ONE flash item at `price`. In `resolve` mode the commission
 * comes from the band the price lands in (else the flat rate); in `override` mode it is
 * applied verbatim (the current scenario). A null variant → NO_PRODUCT, a null probe
 * econ → NO_COST / NO_SHIPPING — the same ordering the detail view uses.
 */
export function computeFlashEstimate(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: FlashEstimateCommission,
  price: Decimal,
): ComputedFlashEstimate {
  if (variant === null) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      commissionPct: null,
      commissionSource: null,
      breakdown: null,
    };
  }

  const resolved: ResolvedFlashCommission =
    commission.kind === 'override'
      ? { pct: commission.pct, source: 'current' }
      : resolveFlashCommission(commission.bands, commission.flatPct, price);

  const probe = assembleUnitEconomics(ctx, variant, {
    costAggregate,
    commission: tariffCommission(resolved.pct),
    shipping,
  });

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
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
    breakdown: serializeBreakdown(computeUnitProfit(probe.econ, price)),
  };
}
