import { Decimal } from 'decimal.js';

import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionBand,
  type TrendyolCommissionRules,
  type TrendyolItemAttributes,
} from './trendyol-inputs';

const ZERO = new Decimal(0);

export type TrendyolCommissionRateSource =
  | 'OVERRIDE'
  | 'ORDER'
  | 'PRODUCT_SYNC'
  | 'CATEGORY_BRAND'
  | 'CATEGORY';

export interface ResolvedTrendyolCommissionRate {
  readonly ratePct: Decimal;
  readonly source: TrendyolCommissionRateSource;
}

/**
 * The first band, in the given order, whose inclusive limits contain `unitPrice`:
 * (`lowerLimit` is null or price >= lowerLimit) and (`upperLimit` is null or
 * price <= upperLimit). A price on a shared boundary therefore resolves to the
 * band listed first. Returns null when no band matches.
 */
export function trendyolBandForPrice(
  bands: readonly TrendyolCommissionBand[],
  unitPrice: Decimal,
): TrendyolCommissionBand | null {
  for (const band of bands) {
    const aboveLower = band.lowerLimit === null || unitPrice.gte(band.lowerLimit);
    const belowUpper = band.upperLimit === null || unitPrice.lte(band.upperLimit);
    if (aboveLower && belowUpper) {
      return band;
    }
  }
  return null;
}

/**
 * Resolves an item's effective Trendyol commission rate through the single chain,
 * first match wins (owner decision 2026-11-09):
 *   0. OVERRIDE     - a scenario's explicit rate, applied verbatim including 0,
 *   1. ORDER        - a positive order-line rate,
 *   2. PRODUCT_SYNC - a positive synced product rate,
 *   3. CATEGORY_BRAND / CATEGORY - the lowest of the category+brand rule (only when
 *      both ids exist) and the category rule; CATEGORY on a tie.
 * Tariff bands are NEVER consulted for an order: they belong to the campaign screens,
 * which pass their chosen band rate as the OVERRIDE rung instead. A zero is meaningful
 * only at the OVERRIDE rung: an order or synced rate of 0 means "not sent" (phase 2A)
 * and falls through. Returns null when nothing applies, which the caller turns into a
 * blocking MISSING_COMMISSION_RATE issue instead of a silent zero.
 */
export function resolveTrendyolCommissionRate(params: {
  readonly item: TrendyolItemAttributes;
  readonly rules: TrendyolCommissionRules;
}): ResolvedTrendyolCommissionRate | null {
  const { item, rules } = params;

  if (item.commissionRatePctOverride !== null) {
    return { ratePct: item.commissionRatePctOverride, source: 'OVERRIDE' };
  }

  if (item.orderCommissionRatePct !== null && item.orderCommissionRatePct.gt(ZERO)) {
    return { ratePct: item.orderCommissionRatePct, source: 'ORDER' };
  }

  if (item.syncedCommissionRatePct !== null && item.syncedCommissionRatePct.gt(ZERO)) {
    return { ratePct: item.syncedCommissionRatePct, source: 'PRODUCT_SYNC' };
  }

  const brandRate =
    item.categoryId !== null && item.brandId !== null
      ? (rules.categoryBrandRatePct.get(trendyolCategoryBrandKey(item.categoryId, item.brandId)) ??
        null)
      : null;
  const categoryRate =
    item.categoryId !== null ? (rules.categoryRatePct.get(item.categoryId) ?? null) : null;

  if (brandRate !== null && categoryRate !== null) {
    return brandRate.lt(categoryRate)
      ? { ratePct: brandRate, source: 'CATEGORY_BRAND' }
      : { ratePct: categoryRate, source: 'CATEGORY' };
  }
  if (brandRate !== null) {
    return { ratePct: brandRate, source: 'CATEGORY_BRAND' };
  }
  if (categoryRate !== null) {
    return { ratePct: categoryRate, source: 'CATEGORY' };
  }

  return null;
}
