import type { DiscountListListItem } from '../api/list-discount-lists.api';

/**
 * Pure derivations for the İndirimler (Discounts) LIST screen. Kept framework-free so the table
 * and the summary strip read the same numbers and the logic stays unit-testable. Values come
 * straight from the backend list endpoint. Like the Flash list there is NO validity axis on the
 * LIST — the only status dimension is upload/export state. Unlike Flash, the row carries the
 * discount CONFIG (type + per-type parameters) so the summary component can render the type
 * badge and the one-line config summary without a second fetch.
 */

/** The upload/export status of a saved discount list — the list's only status axis. */
export type DiscountListStatus = 'exported' | 'pending';

/** Flat row shape the Discounts list table renders — one row per saved upload. */
export interface DiscountListRow {
  id: string;
  name: string;
  discountType: DiscountListListItem['discountType'];
  valueKind: DiscountListListItem['valueKind'];
  value: string | null;
  minBasketAmount: string | null;
  minQuantity: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  nthIndex: number | null;
  startsAt: string | null;
  endsAt: string | null;
  /** Product-selection rows in the upload. */
  itemCount: number;
  /** How many rows are already included in the discount (participation progress). */
  selectedCount: number;
  exported: boolean;
  /** ISO timestamp of the last change (formatted in the row via next-intl). */
  updatedAt: string;
}

/** The upload/export status of a row (derived — there is no validity for the Discounts list). */
export function statusForRow(row: DiscountListRow): DiscountListStatus {
  return row.exported ? 'exported' : 'pending';
}

/** Projects the backend list items into the table's flat row model (identity). */
export function toListRows(items: readonly DiscountListListItem[]): DiscountListRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    discountType: item.discountType,
    valueKind: item.valueKind,
    value: item.value,
    minBasketAmount: item.minBasketAmount,
    minQuantity: item.minQuantity,
    buyQuantity: item.buyQuantity,
    payQuantity: item.payQuantity,
    nthIndex: item.nthIndex,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    itemCount: item.itemCount,
    selectedCount: item.selectedCount,
    exported: item.exported,
    updatedAt: item.updatedAt,
  }));
}

/** Case-insensitive match on the upload name (the only free-text field the list carries). */
export function matchesDiscountListQuery(row: DiscountListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return row.name.toLocaleLowerCase('tr').includes(needle);
}

export interface DiscountListStats {
  /** Total saved discount uploads. */
  total: number;
  /** Total product-selection rows across all uploads. */
  itemTotal: number;
  /** Total included rows across all uploads. */
  selectedTotal: number;
  /** How many uploads have been exported (saved & downloaded). */
  exportedCount: number;
  /** How many uploads are still awaiting export. */
  pendingCount: number;
  /** ISO timestamp of the most recent change across all uploads (trust stamp). */
  lastUpdatedAt: string | null;
}

/** At-a-glance summary metrics for the Discounts list header strip. */
export function summarizeDiscountLists(rows: readonly DiscountListRow[]): DiscountListStats {
  const exportedCount = rows.filter((row) => row.exported).length;
  return {
    total: rows.length,
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
