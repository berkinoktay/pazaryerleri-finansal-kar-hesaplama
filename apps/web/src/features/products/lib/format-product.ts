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

/**
 * Pick the dominant delivery duration across variants — used as the
 * aggregated "Teslimat" cell on the parent row. If variants disagree,
 * returns null so the UI renders a "Karışık" (mixed) badge instead.
 */
export function dominantDeliveryDuration(variants: VariantSummary[]): {
  value: number | null;
  mixed: boolean;
} {
  if (variants.length === 0) return { value: null, mixed: false };
  const values = variants.map((v) => v.deliveryDuration);
  const distinct = new Set(values.map((v) => (v === null ? 'null' : v.toString())));
  if (distinct.size === 1) {
    return { value: values[0] ?? null, mixed: false };
  }
  return { value: null, mixed: true };
}

export type StatusValue = VariantSummary['status'];

/**
 * Most-common status across variants for the parent row's status badge.
 * If only one status is represented, returns it as-is; if multiple are
 * represented, returns the dominant one + a count of "other" variants
 * for the UI to render as "2 satışta · 1 arşiv" style.
 */
export interface StatusSummary {
  dominant: StatusValue;
  counts: Partial<Record<StatusValue, number>>;
  isMixed: boolean;
}

export function summarizeStatus(variants: VariantSummary[]): StatusSummary | null {
  if (variants.length === 0) return null;
  const counts: Partial<Record<StatusValue, number>> = {};
  for (const v of variants) {
    counts[v.status] = (counts[v.status] ?? 0) + 1;
  }
  const entries = Object.entries(counts) as [StatusValue, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const dominant = entries[0]?.[0];
  if (dominant === undefined) return null;
  return { dominant, counts, isMixed: entries.length > 1 };
}

/**
 * Returns up to N unique sizes across the variants for the parent row.
 * Primarily used in the "size" column when the parent represents
 * multiple variants — e.g. "S, M, L".
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
