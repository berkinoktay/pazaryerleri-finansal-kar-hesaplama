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
// variants. Mirrors priceRange: returns null when none of the variants
// have a value yet, otherwise reports the min/max of the effective
// desi across all variants.
export interface DesiRange {
  min: string;
  max: string;
  isSingle: boolean;
  anyOverridden: boolean;
}

export function desiRange(variants: VariantSummary[]): DesiRange | null {
  if (variants.length === 0) return null;
  const values = variants
    .map((v) => (v.dimensionalWeight !== null ? Number.parseFloat(v.dimensionalWeight) : null))
    .filter((n): n is number => n !== null && Number.isFinite(n));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min: min.toString(),
    max: max.toString(),
    isSingle: min === max,
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
