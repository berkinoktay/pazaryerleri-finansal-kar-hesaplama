import type { TariffTemplate, TariffValidity } from '../types';

/**
 * Pure derivations for the commission-tariff LIST screen. Kept framework-free so
 * the table, the card grid, and the summary strip all read the same numbers and
 * the logic stays unit-testable. The real values come from the backend list
 * endpoint (`productCount`, `exported`, `validity`); these stand in for the mock.
 */

/** Distinct products across all of a tariff's periods (a product can repeat per period). */
export function countDistinctProducts(template: TariffTemplate): number {
  const ids = new Set<string>();
  for (const period of template.periods) {
    for (const row of period.rows) ids.add(row.id);
  }
  return ids.size;
}

/** Flat row shape the list table + card grid both render — one row per saved tariff. */
export interface TariffListRow {
  id: string;
  name: string;
  sourceFilename: string;
  relativeLabel: string;
  productCount: number;
  validity: TariffValidity | null;
  exported: boolean;
}

/** Projects the saved templates (+ export flags) into the list's flat row model. */
export function toListRows(
  templates: readonly TariffTemplate[],
  exportedIds: Readonly<Record<string, boolean>>,
): TariffListRow[] {
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    sourceFilename: template.sourceFilename,
    relativeLabel: template.relativeLabel,
    productCount: countDistinctProducts(template),
    validity: template.validity,
    exported: exportedIds[template.id] === true,
  }));
}

/** Case-insensitive match across the searchable fields of a tariff row. */
export function matchesTariffQuery(row: TariffListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return (
    row.name.toLocaleLowerCase('tr').includes(needle) ||
    row.sourceFilename.toLocaleLowerCase('tr').includes(needle) ||
    row.relativeLabel.toLocaleLowerCase('tr').includes(needle)
  );
}

export interface TariffListStats {
  /** Total saved tariffs. */
  total: number;
  /** Relative label of the currently-active tariff, or `null` when none is live. */
  activeLabel: string | null;
  /** Product count of the active tariff, or `null` when none is live. */
  coveredProducts: number | null;
  /** How many tariffs have been exported (saved & downloaded). */
  exportedCount: number;
}

/** At-a-glance summary metrics for the list header strip. */
export function summarizeTariffList(
  templates: readonly TariffTemplate[],
  exportedIds: Readonly<Record<string, boolean>>,
): TariffListStats {
  const active = templates.find((template) => template.validity === 'active') ?? null;
  const exportedCount = templates.filter((template) => exportedIds[template.id] === true).length;
  return {
    total: templates.length,
    activeLabel: active?.relativeLabel ?? null,
    coveredProducts: active === null ? null : countDistinctProducts(active),
    exportedCount,
  };
}
