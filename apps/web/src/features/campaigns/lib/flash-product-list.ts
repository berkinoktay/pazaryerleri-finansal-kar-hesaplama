import type { FlashProductListItem } from '../api/list-flash-products.api';

/**
 * Pure derivations for the Flash Products LIST screen. Kept framework-free so the table
 * and the summary strip read the same numbers and the logic stays unit-testable. Values
 * come straight from the backend list endpoint (`productCount`, `itemCount`,
 * `selectedCount`, `exported`, `updatedAt`). Like the Advantage list there is NO validity
 * axis on the LIST — the only status dimension is upload/export state (the per-offer
 * window validity lives on the detail rows).
 */

/** The upload/export status of a saved Flash list — the list's only status axis. */
export type FlashProductStatus = 'exported' | 'pending';

/** Flat row shape the Flash list table renders — one row per saved upload. */
export interface FlashProductListRow {
  id: string;
  name: string;
  /** Distinct products across the upload's offer rows. */
  productCount: number;
  /** Offer rows (product × date) in the upload. */
  itemCount: number;
  /** How many offer rows already have a chosen offer or custom price (participation progress). */
  selectedCount: number;
  exported: boolean;
  /** ISO timestamp of the last change (formatted in the row via next-intl). */
  updatedAt: string;
}

/** The upload/export status of a row (derived — there is no validity for the Flash list). */
export function statusForRow(row: FlashProductListRow): FlashProductStatus {
  return row.exported ? 'exported' : 'pending';
}

/** Projects the backend list items into the table's flat row model (near-identity). */
export function toListRows(items: readonly FlashProductListItem[]): FlashProductListRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    productCount: item.productCount,
    itemCount: item.itemCount,
    selectedCount: item.selectedCount,
    exported: item.exported,
    updatedAt: item.updatedAt,
  }));
}

/** Case-insensitive match on the upload name (the only free-text field the list carries). */
export function matchesFlashProductQuery(row: FlashProductListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return row.name.toLocaleLowerCase('tr').includes(needle);
}

export interface FlashProductListStats {
  /** Total saved Flash uploads. */
  total: number;
  /** Total distinct products across all uploads. */
  productTotal: number;
  /** Total offer rows across all uploads. */
  itemTotal: number;
  /** Total offer rows with a chosen offer/custom price across all uploads. */
  selectedTotal: number;
  /** How many uploads have been exported (saved & downloaded). */
  exportedCount: number;
  /** How many uploads are still awaiting export. */
  pendingCount: number;
  /** ISO timestamp of the most recent change across all uploads (trust stamp). */
  lastUpdatedAt: string | null;
}

/** At-a-glance summary metrics for the Flash list header strip. */
export function summarizeFlashProductList(
  rows: readonly FlashProductListRow[],
): FlashProductListStats {
  const exportedCount = rows.filter((row) => row.exported).length;
  return {
    total: rows.length,
    productTotal: rows.reduce((sum, row) => sum + row.productCount, 0),
    itemTotal: rows.reduce((sum, row) => sum + row.itemCount, 0),
    selectedTotal: rows.reduce((sum, row) => sum + row.selectedCount, 0),
    exportedCount,
    pendingCount: rows.length - exportedCount,
    lastUpdatedAt: rows.reduce<string | null>(
      (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
      null,
    ),
  };
}
