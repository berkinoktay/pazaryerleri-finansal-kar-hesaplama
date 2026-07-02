import type { PlusTariffListItem } from '../api/list-plus-tariffs.api';
import type { PlusTariffValidity } from '../types';

/**
 * Pure derivations for the Plus commission-tariff LIST screen. Kept framework-free
 * so the table and the summary strip read the same numbers and the logic stays
 * unit-testable. Values come straight from the backend list endpoint
 * (`productCount`, `selectedCount`, `exported`, `validity`, `updatedAt`). Unlike the
 * commission list there is NO draft bucket: a Plus tariff is always a 7-day period,
 * so validity is active / upcoming / past (null only for unparseable dates).
 */

/** Flat row shape the Plus list table renders — one row per saved Plus tariff. */
export interface PlusTariffListRow {
  id: string;
  name: string;
  productCount: number;
  /** How many products are opted in to Plus (participation progress). */
  selectedCount: number;
  validity: PlusTariffValidity;
  exported: boolean;
  /** ISO timestamp of the last change (formatted in the row via next-intl). */
  updatedAt: string;
}

/** Projects the backend list items into the table's flat row model (near-identity). */
export function toListRows(items: readonly PlusTariffListItem[]): PlusTariffListRow[] {
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
export function matchesPlusTariffQuery(row: PlusTariffListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return row.name.toLocaleLowerCase('tr').includes(needle);
}

export interface PlusTariffListStats {
  /** Total saved Plus tariffs. */
  total: number;
  /** Name of the currently-active tariff, or `null` when none is live. */
  activeLabel: string | null;
  /** Products opted in to Plus in the active tariff, or `null` when none is live. */
  joinedCount: number | null;
  /** How many tariffs have been exported (saved & downloaded). */
  exportedCount: number;
  /** ISO timestamp of the most recent change across all tariffs (trust stamp). */
  lastUpdatedAt: string | null;
  /**
   * Per-validity bucket counts for the total cell's context line. Every parseable
   * row falls into exactly one bucket, so the non-zero buckets reconcile with
   * `total` — a context line that doesn't add up reads as broken. (Plus has no
   * draft bucket; a null validity is a parse edge case that stays uncounted.)
   * Note: activeCount can exceed 1 when uploaded periods overlap;
   * activeLabel/joinedCount still follow "first active wins" above.
   */
  activeCount: number;
  upcomingCount: number;
  pastCount: number;
}

/** At-a-glance summary metrics for the Plus list header strip. */
export function summarizePlusTariffList(rows: readonly PlusTariffListRow[]): PlusTariffListStats {
  const active = rows.find((row) => row.validity === 'active') ?? null;
  return {
    total: rows.length,
    activeLabel: active?.name ?? null,
    joinedCount: active?.selectedCount ?? null,
    exportedCount: rows.filter((row) => row.exported).length,
    lastUpdatedAt: rows.reduce<string | null>(
      (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
      null,
    ),
    activeCount: rows.filter((row) => row.validity === 'active').length,
    upcomingCount: rows.filter((row) => row.validity === 'upcoming').length,
    pastCount: rows.filter((row) => row.validity === 'past').length,
  };
}
