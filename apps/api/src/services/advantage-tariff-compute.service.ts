// Per-tier profit computation for the Advantage Product Labels feature.
//
// The ONE structural novelty vs. the other tariff verticals: the reduced
// commission is NOT in this Excel. Pricing a product at a star tier's threshold
// lands it into a band of the seller's COMMISSION TARIFF, and THAT band's rate is
// the commission. So per tier we look the target price up in the commission
// source's bands (`storedTariffBandForPrice`) and, when the product has no commission
// tariff (or no band matches), fall back to the category rate. Everything else --
// cost, shipping, PSF, stoppage, VAT -- is resolved by the shared scenario engine
// (`@pazarsync/profit`): the screen picks the band (or category) rate and hands it to
// `evaluateScreenScenario` as the engine's commission override. No financial math is
// re-implemented here.
//
// Strategy: resolve the item's CURRENT commission first (the current price's band, else
// the category rate); an unresolvable commission fails the item (NO_COMMISSION) before any
// engine evaluation -- matching the discount and campaign screens. With a commission in
// hand, the current baseline (current price at that commission) decides the cost/shipping
// gate. Then each tier is evaluated at its target price (= the tier upper limit, the
// highest price that still earns the badge -> best profit) under the commission that price
// resolves to.

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
import type { StarTier, StarTierKey } from './advantage-tariff.types';

// Advantage rows can also fail because no commission rate is resolvable (no band
// AND no category rate) -- beyond the shared cost/shipping/product reasons.
export type AdvantageItemReason = TariffItemReason | 'NO_COMMISSION';

/** Where a tier's commission came from -- surfaced so the UI can label fallbacks. */
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

/** The commission inputs resolved for one advantage item (per advantage-labels design). */
export interface ItemCommissionInputs {
  /** The matched commission-tariff bands for this barcode (active period), or null. */
  readonly bands: ReadonlyArray<StoredTariffBand> | null;
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
 * verbatim override -- see `AdvantageEstimateCommission`.
 */
export function resolveCommission(
  commission: ItemCommissionInputs,
  price: Decimal,
): ResolvedCommission | null {
  if (commission.bands !== null && commission.bands.length > 0) {
    const band = storedTariffBandForPrice(commission.bands, price);
    if (band !== null) return { pct: new Decimal(band.commissionPct), source: 'band' };
  }
  if (commission.categoryRate !== null) {
    return { pct: commission.categoryRate, source: 'category' };
  }
  return null;
}

/**
 * Tier results for a NOT-calculable item (no cost / no shipping / no product). The
 * PROFIT is null, but the tier's reduced commission is still resolved and shown --
 * it comes from the pinned commission tariff's band (or the category rate), which
 * is independent of cost/shipping. So the seller sees "komisyon %13,1" per tier
 * even before adding a cost profile. Commission is null only when truly
 * unresolvable (no band AND no category rate -> the NO_COMMISSION case).
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
 * every star tier, but ONLY when that winner is actually PROFITABLE (netProfit > 0) --
 * flagging a loss as the "best" option is misleading. The current baseline is weighed FIRST so a
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
 * Computes every tier's net profit for one advantage item with the scenario engine.
 * Reason order (matching the discount and campaign screens): a store-wide load failure
 * (`base` degraded) -> reason null (the caller has already logged it); no tiers or an
 * unmatched barcode (`base` no-product) -> NO_PRODUCT; no commission resolvable at the
 * current price (no band AND no category rate) -> NO_COMMISSION, returned WITHOUT
 * evaluating the engine; the current baseline (current price at its resolved commission)
 * then gates on cost/shipping -> NO_COST / NO_SHIPPING (or null on the defensive branch);
 * otherwise calculable. Each tier is evaluated at `new Decimal(tier.upperLimit)` under the
 * commission that price resolves to; a tier with no resolvable commission keeps null
 * commission and profit, a tier whose own evaluation is not calculable shows null profit.
 * The engine may throw on a pathological input -- that propagates to the service, which
 * catches it per item.
 */
export function computeAdvantageItemTiers(params: {
  readonly tiers: readonly StarTier[];
  readonly currentPrice: Decimal; // the customer price, as today
  readonly commission: ItemCommissionInputs;
  readonly base: ScreenScenarioBase;
}): ComputedAdvantageItem {
  const { tiers, currentPrice, commission, base } = params;
  const [firstTier] = tiers;

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under
  // a store-wide degrade always reports reason null -- never NO_PRODUCT, even with no tiers.
  if (base.kind === 'degraded') {
    return {
      calculable: false,
      reason: null,
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  // No tiers, or an unmatched barcode: NO_PRODUCT. Tier commissions still shown.
  if (firstTier === undefined || base.kind === 'no-product') {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  // Baseline ("do nothing"): the current price at its resolved commission (band, else
  // category). An unresolvable commission fails the whole item BEFORE the engine runs, so
  // NO_COMMISSION ranks ahead of the cost/shipping gate -- exactly as the discount and
  // campaign screens report it.
  const currentResolved = resolveCommission(commission, currentPrice);
  if (currentResolved === null) {
    return {
      calculable: false,
      reason: 'NO_COMMISSION',
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  // With a commission in hand, the real baseline gates on cost/shipping.
  const currentOutcome = evaluateScreenScenario({
    base: base.base,
    unitPrice: currentPrice,
    commissionPct: currentResolved.pct,
  });
  if (!currentOutcome.calculable) {
    return {
      calculable: false,
      reason: currentOutcome.reason,
      tiers: uncalculableTierResults(tiers, commission),
      bestTierKey: null,
      current: NULL_CURRENT,
    };
  }

  const currentBase: Omit<ComputedCurrentScenario, 'isBest'> = {
    commissionPct: currentResolved.pct.toFixed(4),
    netProfit: formatMoney2(currentOutcome.netProfit),
    marginPct: formatMarginPct2(currentOutcome.statement.saleMarginPct),
  };

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
    // An imported tier limit can carry sub-kurus precision; the engine rejects a unit price
    // with more than two decimals, so round it to the kurus half-up before evaluating --
    // exactly as the discount/campaign screens do. The band lookup above and the wire
    // `price` below keep the unrounded tier limit.
    const outcome = evaluateScreenScenario({
      base: base.base,
      unitPrice: toKurusHalfUp(price),
      commissionPct: resolved.pct,
    });
    return {
      key: tier.key,
      upperLimit: tier.upperLimit,
      lowerLimit: tier.lowerLimit,
      price: price.toFixed(2),
      commissionPct: resolved.pct.toFixed(4),
      commissionSource: resolved.source,
      netProfit: outcome.calculable ? formatMoney2(outcome.netProfit) : null,
      marginPct: outcome.calculable ? formatMarginPct2(outcome.statement.saleMarginPct) : null,
    };
  });

  const { bestTierKey, currentIsBest } = selectBestScenario(currentBase.netProfit, results);
  const current: ComputedCurrentScenario = { ...currentBase, isBest: currentIsBest };

  return { calculable: true, reason: null, tiers: results, bestTierKey, current };
}

// --- Single-price estimate (custom-price what-if) ---

export interface ComputedAdvantageEstimate {
  readonly calculable: boolean;
  readonly reason: AdvantageItemReason | null;
  readonly commissionPct: string | null;
  readonly commissionSource: CommissionSourceKind | null;
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * How the single-price estimate resolves its commission:
 *   - `resolve`  -- from the item's commission inputs at the estimate price: the
 *                  containing band, else the category rate (the custom-price what-if).
 *   - `override` -- the commission is supplied verbatim (the current scenario). It is
 *                  resolved the SAME way the detail's current baseline resolves it -- at
 *                  the customer price -- and injected here so the breakdown mirrors the
 *                  detail row's `current` byte-for-byte, with NO second band lookup. A
 *                  null override means the commission was unresolvable -> NO_COMMISSION.
 */
export type AdvantageEstimateCommission =
  | { readonly kind: 'resolve'; readonly inputs: ItemCommissionInputs }
  | { readonly kind: 'override'; readonly resolved: ResolvedCommission | null };

const ADVANTAGE_NO_PRODUCT_ESTIMATE: ComputedAdvantageEstimate = {
  calculable: false,
  reason: 'NO_PRODUCT',
  commissionPct: null,
  commissionSource: null,
  breakdown: null,
};

/**
 * Full profit breakdown for ONE advantage item at `price` with the scenario engine. In
 * `resolve` mode the commission comes from the band the price lands in (else category);
 * in `override` mode it is applied verbatim (the current scenario). A store-wide load
 * failure (`base` degraded) echoes the resolved commission with a null breakdown and null
 * reason; an unmatched variant (`base` no-product) -> NO_PRODUCT; an unresolvable
 * commission -> NO_COMMISSION (null commission), returned WITHOUT evaluating the engine;
 * the scenario is then evaluated at `price` and a cost/shipping gate -> NO_COST /
 * NO_SHIPPING (commission echoed), else the 4-decimal-margin breakdown. Same ordering the
 * detail view uses.
 */
export function computeAdvantageEstimate(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: AdvantageEstimateCommission;
  readonly price: Decimal;
}): ComputedAdvantageEstimate {
  const { base, commission, price } = params;

  const resolved =
    commission.kind === 'override'
      ? commission.resolved
      : resolveCommission(commission.inputs, price);

  // A store-wide load failure (already logged) is checked FIRST, so a matched item under
  // a store-wide degrade reports reason null (never NO_PRODUCT). Echo the resolved
  // commission; the breakdown could not be computed.
  if (base.kind === 'degraded') {
    return {
      calculable: false,
      reason: null,
      commissionPct: resolved?.pct.toFixed(4) ?? null,
      commissionSource: resolved?.source ?? null,
      breakdown: null,
    };
  }

  if (base.kind === 'no-product') {
    return ADVANTAGE_NO_PRODUCT_ESTIMATE;
  }

  // An unresolvable commission fails the item BEFORE the engine runs, so NO_COMMISSION
  // ranks ahead of the cost/shipping gate -- the same ordering the detail view uses.
  if (resolved === null) {
    return {
      calculable: false,
      reason: 'NO_COMMISSION',
      commissionPct: null,
      commissionSource: null,
      breakdown: null,
    };
  }

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
