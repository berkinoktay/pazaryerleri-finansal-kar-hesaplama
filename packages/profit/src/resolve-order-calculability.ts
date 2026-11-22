/**
 * Calculability gate (spec 2026-06-11 order-line-variant-recovery, widened by
 * plan PR-2c / spec 2026-11-22 desi-zorunlu-gun-sonu).
 *
 * Orders are ALWAYS written — this gate only decides full-profit vs waiting
 * (today's order parks in the live-performance buffer; a past-day order is
 * permanently excluded by the callers). An order is calculable only when every
 * line has a cost AND every resolved non-digital line has an effective desi:
 *
 *   - `cost_missing`: a line with no resolved variant (no variant ⇒ no cost
 *     profile link) or no cost. Every line is checked for cost FIRST, so when an
 *     order misses both a cost and a desi (on the same or on different lines) the
 *     cost reason wins. `variantId: null` lets callers log the variant gap.
 *   - `desi_missing`: a resolved, non-digital line whose effective desi
 *     (seller override ?? Trendyol desi) is empty. A desi of 0 is a REAL desi. A
 *     digital line ships no cargo, so it never needs a desi (it still needs a cost).
 *     The order's cargo-measured desi (`cargoDeci`) never stands in for it.
 *
 * Caller responsibility: assemble `lines[]` by resolving the variant via
 * `barcode` and reading the cost, desi and digital flag (`buildCalcCheckLines`).
 */

export interface OrderLineForCalcCheck {
  /** Vendor-supplied barcode on the order line. */
  barcode: string;
  /** Resolved product variant id, or null if not found in this store. */
  variantId: string | null;
  /** Cost snapshot net (TRY decimal as string), or null if no cost profile. */
  unitCostSnapshotNet: string | null;
  /**
   * Effective desi (override ?? synced) as a decimal string; null when the variant
   * has no desi at all, or when the line has no resolved variant. '0' is a real desi.
   */
  unitDesi: string | null;
  /** The variant's digital flag; false for a line with no resolved variant. */
  isDigital: boolean;
}

export type CalcResult =
  | { kind: 'calculable' }
  | {
      kind: 'skip';
      reason: 'cost_missing' | 'desi_missing';
      barcode: string;
      variantId: string | null;
    };

/** A resolved, non-digital line with no effective desi. */
function isDesilessLine(line: OrderLineForCalcCheck): boolean {
  return line.variantId !== null && !line.isDigital && line.unitDesi === null;
}

/**
 * True iff some resolved, non-digital line has no effective desi. An unresolved
 * line is never counted here: it already fails the cost check, and its gap is a
 * cost gap.
 */
export function hasMissingDesi(lines: readonly OrderLineForCalcCheck[]): boolean {
  return lines.some(isDesilessLine);
}

export function resolveOrderCalculability(lines: readonly OrderLineForCalcCheck[]): CalcResult {
  // Cost first across EVERY line, so a cost gap always wins over a desi gap.
  for (const line of lines) {
    if (line.variantId === null || line.unitCostSnapshotNet === null) {
      return {
        kind: 'skip',
        reason: 'cost_missing',
        barcode: line.barcode,
        variantId: line.variantId,
      };
    }
  }
  const desiless = lines.find(isDesilessLine);
  if (desiless !== undefined) {
    return {
      kind: 'skip',
      reason: 'desi_missing',
      barcode: desiless.barcode,
      variantId: desiless.variantId,
    };
  }
  return { kind: 'calculable' };
}
