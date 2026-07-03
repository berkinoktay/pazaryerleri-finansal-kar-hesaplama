import { Decimal } from 'decimal.js';

import type { PlusScenario, PlusTariffDetailItem } from '../types';

/**
 * Per-item Plus opt-in map: `true` = the seller joined Plus AT THE CEILING price,
 * `false`/absent = not joined at the ceiling. Unlike the commission tariff (a band
 * KEY per row), the Plus model is a single boolean per row.
 *
 * This pairs with {@link PlusCustomPriceMap}: the two maps are MUTUALLY EXCLUSIVE
 * per row — a row is either ceiling-joined (`selection[id] === true`), custom-joined
 * (`customPrices[id] != null`), or not joined. Setting one clears the other.
 */
export type PlusSelectionMap = Record<string, boolean>;

/**
 * A committed custom Plus price for one product: the seller typed a price at/below
 * the ceiling and confirmed it with "Seç". The estimated profit/margin are captured
 * at confirm time so the header summary can total the joined products without
 * re-estimating. `price` is a GROSS decimal string.
 */
export interface PlusCustomChoice {
  price: string;
  netProfit: string | null;
  marginPct: string | null;
}

/** Per-item committed custom price, or null/absent when the row is not custom-joined. */
export type PlusCustomPriceMap = Record<string, PlusCustomChoice | null>;

/**
 * Whether the seller has joined Plus for this row — at the ceiling OR at a custom
 * price. The single "is joined" predicate for export, summary, and filtering.
 */
export function isJoinedRow(
  selection: PlusSelectionMap,
  customPrices: PlusCustomPriceMap,
  itemId: string,
): boolean {
  return selection[itemId] === true || customPrices[itemId] != null;
}

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

/** The full per-row join state: ceiling opt-ins + custom-price opt-ins. */
export interface PlusSelectionState {
  selection: PlusSelectionMap;
  customPrices: PlusCustomPriceMap;
}

/**
 * Join every listed calculable product to Plus AT THE CEILING (uncalculable rows
 * cannot join). Joining at the ceiling clears any per-row custom price, keeping the
 * two maps mutually exclusive.
 */
export function joinAll(
  rows: readonly PlusTariffDetailItem[],
  state: PlusSelectionState,
): PlusSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (row.calculable) {
      selection[row.id] = true;
      customPrices[row.id] = null;
    }
  }
  return { selection, customPrices };
}

/**
 * Join (at the ceiling) only the rows where Plus nets more than the current
 * price/commission (`plusIsBetter`). This is the useful default: often the lower
 * Plus-ceiling price hurts more than the reduced commission helps, so joining every
 * product is a mistake — this joins only the ones that genuinely win. Custom-priced
 * rows it touches switch to the ceiling; rows it does not touch keep their choice.
 */
export function joinProfitable(
  rows: readonly PlusTariffDetailItem[],
  state: PlusSelectionState,
): PlusSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    if (row.calculable && row.plusIsBetter) {
      selection[row.id] = true;
      customPrices[row.id] = null;
    }
  }
  return { selection, customPrices };
}

/** Un-join the listed rows entirely (both ceiling and custom). */
export function clearJoins(
  rows: readonly PlusTariffDetailItem[],
  state: PlusSelectionState,
): PlusSelectionState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    selection[row.id] = false;
    customPrices[row.id] = null;
  }
  return { selection, customPrices };
}

export function filterPlusRows(
  rows: readonly PlusTariffDetailItem[],
  selection: PlusSelectionMap,
  customPrices: PlusCustomPriceMap,
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

    const joined = isJoinedRow(selection, customPrices, row.id);
    if (filters.selection === 'selected' && !joined) return false;
    if (filters.selection === 'unselected' && joined) return false;

    return true;
  });
}
