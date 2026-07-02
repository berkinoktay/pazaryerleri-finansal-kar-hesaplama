import type { CommissionTariffListItem } from '../api/list-tariffs.api';
import type { TariffValidity } from '../types';

/**
 * Pure derivations for the commission-tariff LIST screen. Kept framework-free so
 * the table and the summary strip read the same numbers and the logic stays
 * unit-testable. The real values come straight from the backend list endpoint
 * (`productCount`, `selectedCount`, `exported`, `validity`, `updatedAt`).
 */

/** Flat row shape the list table renders — one row per saved tariff. */
export interface TariffListRow {
  id: string;
  name: string;
  productCount: number;
  /** How many products have a band chosen (selection progress). */
  selectedCount: number;
  validity: TariffValidity | null;
  exported: boolean;
  /** ISO timestamp of the last change (formatted in the row via next-intl). */
  updatedAt: string;
}

/** Projects the backend list items into the table's flat row model (near-identity). */
export function toListRows(items: readonly CommissionTariffListItem[]): TariffListRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    productCount: item.productCount,
    selectedCount: item.selectedCount,
    validity: item.validity,
    exported: item.exported,
    updatedAt: item.updatedAt,
  }));
}

/** Case-insensitive match on the tariff name (the only free-text field the list carries). */
export function matchesTariffQuery(row: TariffListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return row.name.toLocaleLowerCase('tr').includes(needle);
}

export interface TariffListStats {
  /** Total saved tariffs. */
  total: number;
  /** Name of the currently-active tariff, or `null` when none is live. */
  activeLabel: string | null;
  /** Product count of the active tariff, or `null` when none is live. */
  coveredProducts: number | null;
  /** How many tariffs have been exported (saved & downloaded). */
  exportedCount: number;
  /** ISO timestamp of the most recent change across all tariffs (trust stamp). */
  lastUpdatedAt: string | null;
}

/** At-a-glance summary metrics for the list header strip. */
export function summarizeTariffList(rows: readonly TariffListRow[]): TariffListStats {
  const active = rows.find((row) => row.validity === 'active') ?? null;
  return {
    total: rows.length,
    activeLabel: active?.name ?? null,
    coveredProducts: active?.productCount ?? null,
    exportedCount: rows.filter((row) => row.exported).length,
    lastUpdatedAt: rows.reduce<string | null>(
      (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
      null,
    ),
  };
}
