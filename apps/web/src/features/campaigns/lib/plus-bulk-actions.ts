import { Decimal } from 'decimal.js';

import type { PlusScenario, PlusTariffDetailItem } from '../types';

/**
 * Per-item Plus opt-in map: `true` = the seller joined Plus for the product,
 * `false`/absent = not joined. Unlike the commission tariff (a band KEY per row),
 * the Plus model is a single boolean per row — join or don't.
 */
export type PlusSelectionMap = Record<string, boolean>;

/** Plus-scenario profit filter (based on the PLUS offer's net profit sign). */
export type PlusProfitFilter = 'all' | 'profitable' | 'loss';

/** Join-state filter. */
export type PlusSelectionFilter = 'all' | 'selected' | 'unselected';

/**
 * The detail screen's five client-side filter dimensions. Structurally identical
 * to the commission `TariffFilterState`, so the shared advanced-filter chip
 * adapters in `tariff-filter-fields.ts` map to/from it — only the profit/margin
 * SEMANTICS differ (they read the PLUS scenario, not a best band).
 */
export interface PlusTariffFilterState {
  query: string;
  category: string | null;
  brand: string | null;
  /** Show only rows whose PLUS-scenario margin is at least this percent. */
  minMarginPct: number | null;
  profit: PlusProfitFilter;
  selection: PlusSelectionFilter;
}

/** A scenario's net profit as a Decimal, or null when the row is not calculable. */
function scenarioProfit(scenario: PlusScenario): Decimal | null {
  return scenario.netProfit !== null ? new Decimal(scenario.netProfit) : null;
}

/** Whether the seller has joined Plus for this row. */
export function isJoined(selection: PlusSelectionMap, itemId: string): boolean {
  return selection[itemId] === true;
}

/** Join every listed calculable product to Plus (uncalculable rows cannot join). */
export function joinAll(
  rows: readonly PlusTariffDetailItem[],
  prev: PlusSelectionMap,
): PlusSelectionMap {
  const next = { ...prev };
  for (const row of rows) {
    if (row.calculable) next[row.id] = true;
  }
  return next;
}

/**
 * Join only the rows where Plus nets more than the current price/commission
 * (`plusIsBetter`). This is the useful default: often the lower Plus-ceiling
 * price hurts more than the reduced commission helps, so joining every product
 * is a mistake — this joins only the ones that genuinely win.
 */
export function joinProfitable(
  rows: readonly PlusTariffDetailItem[],
  prev: PlusSelectionMap,
): PlusSelectionMap {
  const next = { ...prev };
  for (const row of rows) {
    if (row.calculable && row.plusIsBetter) next[row.id] = true;
  }
  return next;
}

/** Un-join the listed rows. */
export function clearJoins(
  rows: readonly PlusTariffDetailItem[],
  prev: PlusSelectionMap,
): PlusSelectionMap {
  const next = { ...prev };
  for (const row of rows) next[row.id] = false;
  return next;
}

export function filterPlusRows(
  rows: readonly PlusTariffDetailItem[],
  selection: PlusSelectionMap,
  filters: PlusTariffFilterState,
): PlusTariffDetailItem[] {
  const query = filters.query.trim().toLocaleLowerCase('tr');
  return rows.filter((row) => {
    if (
      query !== '' &&
      ![row.productTitle, row.stockCode, row.barcode].some((field) =>
        (field ?? '').toLocaleLowerCase('tr').includes(query),
      )
    ) {
      return false;
    }
    if (filters.category !== null && row.category !== filters.category) return false;
    if (filters.brand !== null && row.brand !== filters.brand) return false;

    const plusMargin = row.plus.marginPct;
    const plusProfit = scenarioProfit(row.plus);
    if (
      filters.minMarginPct !== null &&
      (plusMargin === null || Number(plusMargin) < filters.minMarginPct)
    ) {
      return false;
    }
    if (filters.profit === 'profitable' && !(plusProfit !== null && plusProfit.greaterThan(0))) {
      return false;
    }
    if (filters.profit === 'loss' && (plusProfit === null || plusProfit.greaterThan(0))) {
      return false;
    }

    const joined = isJoined(selection, row.id);
    if (filters.selection === 'selected' && !joined) return false;
    if (filters.selection === 'unselected' && joined) return false;

    return true;
  });
}
