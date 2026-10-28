import Decimal from 'decimal.js';

import { formatTrDecimal } from '@/lib/parse-tr-decimal';

import type { ProductWithVariants, VariantSummary } from '../api/list-products.api';

// Aggregations for the parent row when a product has multiple variants.
// Each helper handles the empty-variants case explicitly because a
// status filter at the API level may leave a parent with zero matching
// variants in the response (although that case is normally filtered
// out by the API's `where: { variants: { some: ... } }` clause).

export interface PriceRange {
  min: string;
  max: string;
  isSingle: boolean;
}

export function priceRange(variants: VariantSummary[]): PriceRange | null {
  if (variants.length === 0) return null;
  const prices = variants.map((v) => Number.parseFloat(v.salePrice)).filter(Number.isFinite);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    min: min.toFixed(2),
    max: max.toFixed(2),
    isSingle: min === max,
  };
}

export function totalStock(variants: VariantSummary[]): number {
  return variants.reduce((sum, v) => sum + v.quantity, 0);
}

// Aggregate for the parent row's desi column when a product has multiple
// variants. Variants the backend flags as missing desi
// (`isDimensionalWeightMissing`) carry a placeholder "0", not a real desi, so
// they are skipped: a range of "0 - 2" would read as a real 0-desi variant.
// Returns null when no variant has a known desi. min/max are display strings
// in Turkish format ("1,5"); the comparison runs on Decimal values.
export interface DesiRange {
  min: string;
  max: string;
  isSingle: boolean;
  anyOverridden: boolean;
}

export function desiRange(variants: VariantSummary[]): DesiRange | null {
  const values = variants.flatMap((v) =>
    v.isDimensionalWeightMissing || v.dimensionalWeight === null
      ? []
      : [new Decimal(v.dimensionalWeight)],
  );
  const first = values[0];
  if (first === undefined) return null;
  const min = Decimal.min(first, ...values);
  const max = Decimal.max(first, ...values);
  return {
    min: formatTrDecimal(min),
    max: formatTrDecimal(max),
    isSingle: min.eq(max),
    anyOverridden: variants.some((v) => v.isDimensionalWeightOverridden),
  };
}

/**
 * Shipping-speed tier of a variant, read from Trendyol's `deliveryDuration`
 * (the number of days the seller has to hand the parcel to the carrier).
 * Trendyol retired its rush-delivery flag and fast-delivery option list in
 * August 2026, so `deliveryDuration` is the only signal left:
 *
 *   - 'today'    -> 0, the ships-today program
 *   - 'tomorrow' -> 1, ships by the next day at the latest
 *   - 'later'    -> 2 or more days
 *   - 'unknown'  -> Trendyol sent no value, or a value that is not a
 *                   non-negative integer
 */
export type DeliveryTier = 'today' | 'tomorrow' | 'later' | 'unknown';

export interface DeliveryInfo {
  tier: DeliveryTier;
  /** The day count behind the tier; null only for the 'unknown' tier. */
  days: number | null;
}

const SHIPS_TODAY_DURATION = 0;
const SHIPS_TOMORROW_DURATION = 1;

export function computeDeliveryInfo(variant: { deliveryDuration: number | null }): DeliveryInfo {
  const days = variant.deliveryDuration;
  if (days === null || !Number.isInteger(days) || days < 0) {
    return { tier: 'unknown', days: null };
  }
  if (days === SHIPS_TODAY_DURATION) return { tier: 'today', days };
  if (days === SHIPS_TOMORROW_DURATION) return { tier: 'tomorrow', days };
  return { tier: 'later', days };
}

/**
 * Delivery tier for the parent row's "Teslimat" cell. When every variant
 * reports the same tier and day count, returns that info; when they
 * disagree, returns `mixed: true` so the UI renders a "mixed" chip instead
 * of implying one uniform promise for the whole product. An empty list has
 * no info at all.
 */
export function dominantDeliveryInfo(
  variants: ReadonlyArray<{ deliveryDuration: number | null }>,
): { info: DeliveryInfo | null; mixed: boolean } {
  const first = variants[0];
  if (first === undefined) return { info: null, mixed: false };
  const firstInfo = computeDeliveryInfo(first);
  const allSame = variants.every((variant) => {
    const info = computeDeliveryInfo(variant);
    return info.tier === firstInfo.tier && info.days === firstInfo.days;
  });
  return allSame ? { info: firstInfo, mixed: false } : { info: null, mixed: true };
}

/**
 * Returns up to N unique sizes across the variants for the parent row.
 * Primarily used in the "size" column when the parent represents
 * multiple variants, e.g. "S, M, L".
 */
export function uniqueSizes(
  variants: VariantSummary[],
  limit = 4,
): {
  shown: string[];
  remaining: number;
} {
  const seen = new Set<string>();
  for (const v of variants) {
    if (v.size !== null && v.size.length > 0) seen.add(v.size);
  }
  const all = [...seen];
  return { shown: all.slice(0, limit), remaining: Math.max(0, all.length - limit) };
}

export function isMultiVariant(product: ProductWithVariants): boolean {
  return product.variantCount > 1;
}

export function getRepresentativeVariant(product: ProductWithVariants): VariantSummary | null {
  return product.variants[0] ?? null;
}
