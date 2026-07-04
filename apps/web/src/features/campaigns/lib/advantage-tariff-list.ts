import type { AdvantageTariffListItem } from '../api/list-advantage-tariffs.api';

/**
 * Pure derivations for the Advantage product-label LIST screen. Kept framework-free so
 * the table and the summary strip read the same numbers and the logic stays
 * unit-testable. Values come straight from the backend list endpoint (`productCount`,
 * `selectedCount`, `exported`, `updatedAt`). Unlike the commission/Plus lists an
 * Advantage file carries NO dates, so there is no validity axis — the only status
 * dimension is upload/export state (exported vs pending).
 */

/** The upload/export status of a saved Advantage tariff — the list's only status axis. */
export type AdvantageTariffStatus = 'exported' | 'pending';

/** Flat row shape the Advantage list table renders — one row per saved tariff. */
export interface AdvantageTariffListRow {
  id: string;
  name: string;
  productCount: number;
  /** How many products already have a chosen star tier (participation progress). */
  selectedCount: number;
  exported: boolean;
  /** ISO timestamp of the last change (formatted in the row via next-intl). */
  updatedAt: string;
}

/** The upload/export status of a row (derived — there is no validity for Advantage). */
export function statusForRow(row: AdvantageTariffListRow): AdvantageTariffStatus {
  return row.exported ? 'exported' : 'pending';
}

/** Projects the backend list items into the table's flat row model (near-identity). */
export function toListRows(items: readonly AdvantageTariffListItem[]): AdvantageTariffListRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    productCount: item.productCount,
    selectedCount: item.selectedCount,
    exported: item.exported,
    updatedAt: item.updatedAt,
  }));
}

/** Case-insensitive match on the tariff name (the only free-text field the list carries). */
export function matchesAdvantageTariffQuery(row: AdvantageTariffListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return row.name.toLocaleLowerCase('tr').includes(needle);
}

export interface AdvantageTariffListStats {
  /** Total saved Advantage tariffs. */
  total: number;
  /** Total products listed across all tariffs. */
  productTotal: number;
  /** Total products with a chosen star tier across all tariffs. */
  selectedTotal: number;
  /** How many tariffs have been exported (saved & downloaded). */
  exportedCount: number;
  /** How many tariffs are still awaiting export. */
  pendingCount: number;
  /** ISO timestamp of the most recent change across all tariffs (trust stamp). */
  lastUpdatedAt: string | null;
}

/** At-a-glance summary metrics for the Advantage list header strip. */
export function summarizeAdvantageTariffList(
  rows: readonly AdvantageTariffListRow[],
): AdvantageTariffListStats {
  const exportedCount = rows.filter((row) => row.exported).length;
  return {
    total: rows.length,
    productTotal: rows.reduce((sum, row) => sum + row.productCount, 0),
    selectedTotal: rows.reduce((sum, row) => sum + row.selectedCount, 0),
    exportedCount,
    pendingCount: rows.length - exportedCount,
    lastUpdatedAt: rows.reduce<string | null>(
      (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
      null,
    ),
  };
}
