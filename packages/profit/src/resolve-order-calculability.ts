/**
 * Calculability gate (spec 2026-06-11 order-line-variant-recovery).
 *
 * Orders are ALWAYS written — this gate only decides full-profit vs
 * cost-missing routing. A line with no resolved variant is by definition
 * cost-missing (no variant ⇒ no cost profile link); `variantId: null` lets
 * callers log the variant gap distinctly.
 *
 * Caller responsibility: assemble `lines[]` by resolving variant via
 * `barcode` and reading `unitCostSnapshotNet` from the cost profile link.
 */

export interface OrderLineForCalcCheck {
  /** Vendor-supplied barcode on the order line. */
  barcode: string;
  /** Resolved product variant id, or null if not found in this store. */
  variantId: string | null;
  /** Cost snapshot net (TRY decimal as string), or null if no cost profile. */
  unitCostSnapshotNet: string | null;
}

export type CalcResult =
  | { kind: 'calculable' }
  | { kind: 'skip'; reason: 'cost_missing'; barcode: string; variantId: string | null };

export function resolveOrderCalculability(lines: OrderLineForCalcCheck[]): CalcResult {
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
  return { kind: 'calculable' };
}
