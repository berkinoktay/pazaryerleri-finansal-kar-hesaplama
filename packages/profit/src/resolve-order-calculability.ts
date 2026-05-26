/**
 * V1 hard-skip gate for order calculability (spec §6, brainstorm 2026-05-24).
 *
 * If any line on an order lacks either a resolved product variant OR a
 * non-null cost snapshot, the entire order is rejected at the sync
 * boundary — never written to the `orders` table. Past suppliers' costs are
 * not recoverable; reflecting "current" cost onto a past order would break
 * snapshot discipline. Uncomputable record = does not exist.
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
  | { kind: 'skip'; reason: 'variant_not_found'; barcode: string }
  | { kind: 'skip'; reason: 'cost_missing'; barcode: string; variantId: string };

export function resolveOrderCalculability(lines: OrderLineForCalcCheck[]): CalcResult {
  for (const line of lines) {
    if (line.variantId === null) {
      return { kind: 'skip', reason: 'variant_not_found', barcode: line.barcode };
    }
    if (line.unitCostSnapshotNet === null) {
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
