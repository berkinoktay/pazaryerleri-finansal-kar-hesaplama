// Per-tier profit computation for the Advantage Product Labels feature.
//
// The ONE structural novelty vs. the other tariff verticals: the reduced
// commission is NOT in this Excel. Pricing a product at a star tier's threshold
// lands it into a band of the seller's COMMISSION TARIFF, and THAT band's rate is
// the commission. So per tier we look the target price up in the commission
// source's bands (`bandForPrice`) and, when the product has no commission tariff
// (or no band matches), fall back to the category rate. Everything else — cost,
// shipping, PSF, stoppage, VAT — is resolved exactly as Ürün Fiyatlandırma does,
// by REUSING `assembleUnitEconomics` + `computeUnitProfit`. No financial math is
// re-implemented here.
//
// Strategy mirrors commission-tariff-compute: assemble the variant's econ ONCE (a
// probe — commission-invariant), then per tier override only `commissionRate` and
// run the engine at the tier's target price (= the tier upper limit, the highest
// price that still earns the badge → best profit).

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type UnitEconomics } from '@pazarsync/profit';

import { bandForPrice } from './commission-tariff-compute.service';
import type { StoredBand } from './commission-tariff.types';
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
import type { StarTier, StarTierKey } from './advantage-tariff.types';
import type { VariantCostAggregate } from '../validators/product.validator';

export type { TariffAssemblyContext, TariffVariant };

// Advantage rows can also fail because no commission rate is resolvable (no band
// AND no category rate) — beyond the shared cost/shipping/product reasons.
export type AdvantageItemReason = TariffItemReason | 'NO_COMMISSION';

/** Where a tier's commission came from — surfaced so the UI can label fallbacks. */
export type CommissionSourceKind = 'band' | 'category';

export interface ComputedTierResult {
  readonly key: StarTierKey;
  readonly upperLimit: string;
  readonly lowerLimit: string | null;
  /** Target price (GROSS TRY) = the tier upper limit (best price still earning the badge). */
  readonly price: string;
  /** Reduced commission PERCENT applied at this tier (e.g. "13.1"); null when unresolved. */
  readonly commissionPct: string | null;
  readonly commissionSource: CommissionSourceKind | null;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

export interface ComputedCurrentScenario {
  /** Reduced commission PERCENT applied at the current customer price (band, else category). */
  readonly commissionPct: string | null;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
  /** True when keeping the current price is the single most-profitable (and positive) option. */
  readonly isBest: boolean;
}

export interface ComputedAdvantageItem {
  readonly calculable: boolean;
  readonly reason: AdvantageItemReason | null;
  readonly tiers: ReadonlyArray<ComputedTierResult>;
  /** Key of the tier with the highest net profit, or null if none calculable. */
  readonly bestTierKey: StarTierKey | null;
  /** Profit at the seller's CURRENT price + its resolved commission (the baseline). */
  readonly current: ComputedCurrentScenario;
}

const NULL_CURRENT: ComputedCurrentScenario = {
  commissionPct: null,
  netProfit: null,
  marginPct: null,
  isBest: false,
};

/** The commission inputs resolved for one advantage item (per §advantage-labels design). */
export interface ItemCommissionInputs {
  /** The matched commission-tariff bands for this barcode (active period), or null. */
  readonly bands: ReadonlyArray<StoredBand> | null;
  /** The category-rate fallback PERCENT (e.g. 19), or null when unresolvable. */
  readonly categoryRate: Decimal | null;
}

/** A resolved reduced commission: the applied PERCENT plus where it came from. */
export interface ResolvedCommission {
  readonly pct: Decimal;
  readonly source: CommissionSourceKind;
}

/**
 * Resolves the commission PERCENT for a price: the containing commission band
 * first (the reduced campaign rate), else the category fallback. Null when
 * neither is available. Band4 is open-ended so a band match is the norm when
 * bands exist; category covers products with no commission tariff.
 *
 * Exported so the estimate service can resolve the current-scenario commission
 * the SAME way the detail baseline does (at the customer price) and inject it as a
 * verbatim override — see `AdvantageEstimateCommission`.
 */
export function resolveCommission(
  commission: ItemCommissionInputs,
  price: Decimal,
): ResolvedCommission | null {
  if (commission.bands !== null && commission.bands.length > 0) {
    const band = bandForPrice(commission.bands, price);
    if (band !== null) return { pct: new Decimal(band.commissionPct), source: 'band' };
  }
  if (commission.categoryRate !== null) {
    return { pct: commission.categoryRate, source: 'category' };
  }
  return null;
}

/**
 * Tier results for a NOT-calculable item (no cost / no shipping / no product). The
 * PROFIT is null, but the tier's reduced commission is still resolved and shown —
 * it comes from the pinned commission tariff's band (or the category rate), which
 * is independent of cost/shipping. So the seller sees "komisyon %13,1" per tier
 * even before adding a cost profile. Commission is null only when truly
 * unresolvable (no band AND no category rate → the NO_COMMISSION case).
 */
function uncalculableTierResults(
  tiers: ReadonlyArray<StarTier>,
  commission: ItemCommissionInputs,
): ComputedTierResult[] {
  return tiers.map((tier) => {
    const price = new Decimal(tier.upperLimit);
    const resolved = resolveCommission(commission, price);
    return {
      key: tier.key,
      upperLimit: tier.upperLimit,
      lowerLimit: tier.lowerLimit,
      price: price.toFixed(2),
      commissionPct: resolved?.pct.toFixed(4) ?? null,
      commissionSource: resolved?.source ?? null,
      netProfit: null,
      marginPct: null,
    };
  });
}

/**
 * Picks the single most-profitable option across the "do nothing" current baseline AND
 * every star tier, but ONLY when that winner is actually PROFITABLE (netProfit > 0) —
 * flagging a loss as "En kârlı" is misleading. The current baseline is weighed FIRST so a
 * tie favors keeping the current price (no reason to change price just to move the badge).
 * When the current price wins, no tier is flagged (`currentIsBest`, `bestTierKey = null`);
 * when a tier wins, only that tier is flagged; when nothing is positive, neither is.
 */
export function selectBestScenario(
  currentNetProfit: string | null,
  tiers: ReadonlyArray<{ readonly key: StarTierKey; readonly netProfit: string | null }>,
): { bestTierKey: StarTierKey | null; currentIsBest: boolean } {
  let bestKey: StarTierKey | 'current' | null = null;
  let bestProfit: Decimal | null = null;
  const consider = (key: StarTierKey | 'current', profit: string | null): void => {
    if (profit === null) return;
    const p = new Decimal(profit);
    if (!p.gt(0)) return;
    if (bestProfit === null || p.gt(bestProfit)) {
      bestProfit = p;
      bestKey = key;
    }
  };
  consider('current', currentNetProfit);
  for (const tier of tiers) consider(tier.key, tier.netProfit);
  return {
    bestTierKey: bestKey !== null && bestKey !== 'current' ? bestKey : null,
    currentIsBest: bestKey === 'current',
  };
}

/**
 * Computes every tier's net profit for one advantage item. `variant` null →
 * NO_PRODUCT. Cost/shipping missing → NO_COST/NO_SHIPPING (probe). Econ ok but no
 * commission resolvable anywhere → NO_COMMISSION. Otherwise each tier overrides
 * only `commissionRate` (resolved per target price) and runs the engine.
 */
export function computeAdvantageItemTiers(
  ctx: TariffAssemblyContext,
  tiers: ReadonlyArray<StarTier>,
  currentPrice: Decimal,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: ItemCommissionInputs,
): ComputedAdvantageItem {
  const [firstTier] = tiers;
  if (variant === null || firstTier === undefined) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  // Probe with a placeholder commission (overridden per tier). Only cost/shipping
  // determine whether econ is null.
  const probeInputs: AssemblyInputs = {
    costAggregate,
    commission: tariffCommission(new Decimal(0)),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, probeInputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  // No commission resolvable at any price → the whole item is not calculable.
  if (resolveCommission(commission, currentPrice) === null) {
    return {
      calculable: false,
      reason: 'NO_COMMISSION',
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  const baseEcon: UnitEconomics = probe.econ;

  // Baseline ("do nothing"): current price at its resolved commission.
  const currentResolved = resolveCommission(commission, currentPrice);
  const currentBase: Omit<ComputedCurrentScenario, 'isBest'> =
    currentResolved === null
      ? { commissionPct: null, netProfit: null, marginPct: null }
      : (() => {
          const breakdown = computeUnitProfit(
            { ...baseEcon, commissionRate: currentResolved.pct },
            currentPrice,
          );
          return {
            commissionPct: currentResolved.pct.toFixed(4),
            netProfit: breakdown.netProfit.toFixed(2),
            marginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
          };
        })();

  const results = tiers.map((tier): ComputedTierResult => {
    const price = new Decimal(tier.upperLimit);
    const resolved = resolveCommission(commission, price);
    if (resolved === null) {
      return {
        key: tier.key,
        upperLimit: tier.upperLimit,
        lowerLimit: tier.lowerLimit,
        price: price.toFixed(2),
        commissionPct: null,
        commissionSource: null,
        netProfit: null,
        marginPct: null,
      };
    }
    const econ: UnitEconomics = { ...baseEcon, commissionRate: resolved.pct };
    const breakdown = computeUnitProfit(econ, price);
    return {
      key: tier.key,
      upperLimit: tier.upperLimit,
      lowerLimit: tier.lowerLimit,
      price: price.toFixed(2),
      commissionPct: resolved.pct.toFixed(4),
      commissionSource: resolved.source,
      netProfit: breakdown.netProfit.toFixed(2),
      marginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
    };
  });

  const { bestTierKey, currentIsBest } = selectBestScenario(currentBase.netProfit, results);
  const current: ComputedCurrentScenario = { ...currentBase, isBest: currentIsBest };

  return { calculable: true, reason: null, tiers: results, bestTierKey, current };
}

// ─── Single-price estimate (custom-price what-if) ────────────────────────────

export interface ComputedAdvantageEstimate {
  readonly calculable: boolean;
  readonly reason: AdvantageItemReason | null;
  readonly commissionPct: string | null;
  readonly commissionSource: CommissionSourceKind | null;
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * How the single-price estimate resolves its commission:
 *   - `resolve`  — from the item's commission inputs at the estimate price: the
 *                  containing band, else the category rate (the custom-price what-if).
 *   - `override` — the commission is supplied verbatim (the current scenario). It is
 *                  resolved the SAME way the detail's current baseline resolves it — at
 *                  the customer price — and injected here so the breakdown mirrors the
 *                  detail row's `current` byte-for-byte, with NO second band lookup. A
 *                  null override means the commission was unresolvable → NO_COMMISSION.
 */
export type AdvantageEstimateCommission =
  | { readonly kind: 'resolve'; readonly inputs: ItemCommissionInputs }
  | { readonly kind: 'override'; readonly resolved: ResolvedCommission | null };

/**
 * Full profit breakdown for ONE advantage item at `price`. In `resolve` mode the
 * commission comes from the band the price lands in (else category); in `override`
 * mode it is applied verbatim (the current scenario). A null variant → NO_PRODUCT,
 * a null probe econ → NO_COST/NO_SHIPPING, an unresolvable commission → NO_COMMISSION
 * — the same ordering the detail view uses.
 */
export function computeAdvantageEstimate(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: AdvantageEstimateCommission,
  price: Decimal,
): ComputedAdvantageEstimate {
  if (variant === null) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      commissionPct: null,
      commissionSource: null,
      breakdown: null,
    };
  }

  const resolved =
    commission.kind === 'override'
      ? commission.resolved
      : resolveCommission(commission.inputs, price);
  const probe = assembleUnitEconomics(ctx, variant, {
    costAggregate,
    commission: tariffCommission(resolved?.pct ?? new Decimal(0)),
    shipping,
  });

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      commissionPct: resolved?.pct.toFixed(4) ?? null,
      commissionSource: resolved?.source ?? null,
      breakdown: null,
    };
  }

  if (resolved === null) {
    return {
      calculable: false,
      reason: 'NO_COMMISSION',
      commissionPct: null,
      commissionSource: null,
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
