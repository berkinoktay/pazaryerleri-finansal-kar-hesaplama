import { Decimal } from 'decimal.js';

import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionBand,
  type TrendyolCommissionRules,
  type TrendyolItemAttributes,
} from './trendyol-inputs';

const ZERO = new Decimal(0);

export type TrendyolCommissionRateSource =
  | 'ORDER'
  | 'TARIFF_BAND'
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
 * first match wins (design 7.2):
 *   1. ORDER        - a positive order-line rate,
 *   2. TARIFF_BAND  - the product tariff band covering the unit price,
 *   3. PRODUCT_SYNC - a positive synced product rate,
 *   4. CATEGORY_BRAND / CATEGORY - the lowest of the category+brand rule (only when
 *      both ids exist) and the category rule; CATEGORY on a tie.
 * Returns null when nothing applies, which the caller turns into a blocking
 * MISSING_COMMISSION_RATE issue instead of a silent zero.
 */
export function resolveTrendyolCommissionRate(params: {
  readonly item: TrendyolItemAttributes;
  readonly unitCommissionBase: Decimal; // roundMoney(saleGross / quantity)
  readonly rules: TrendyolCommissionRules;
}): ResolvedTrendyolCommissionRate | null {
  const { item, unitCommissionBase, rules } = params;

  if (item.orderCommissionRatePct !== null && item.orderCommissionRatePct.gt(ZERO)) {
    return { ratePct: item.orderCommissionRatePct, source: 'ORDER' };
  }

  if (item.tariffBands !== null) {
    const band = trendyolBandForPrice(item.tariffBands, unitCommissionBase);
    if (band !== null) {
      return { ratePct: band.ratePct, source: 'TARIFF_BAND' };
    }
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
