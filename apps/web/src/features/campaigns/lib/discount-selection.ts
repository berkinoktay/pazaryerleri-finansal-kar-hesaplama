import { Decimal } from 'decimal.js';

import type { DiscountRow } from './adapt-discount-list';

/**
 * Pure client-side filtering + smart-select projections for the İndirimler (Discounts) detail
 * table. Selection itself is server-authoritative (each row's `included` is persisted via the
 * selections PATCH); these helpers only decide WHICH visible rows a filter keeps or a
 * "profitable" smart-select targets. The profitable/losing predicates COMPARE two
 * already-backend-computed profit figures (a sign check) — they never compute profit
 * themselves, so the no-frontend-financial-calculation rule holds.
 */

// Buybox ownership labels as they arrive in the Trendyol product-selection file (data values,
// not UI copy — so they are matched literally, never localized).
export const BUYBOX_WINNER = 'Kazanan';
export const BUYBOX_LOSER = 'Kaybeden';

/** The detail toolbar's view state — a search string plus three independent filter chips. */
export interface DiscountFilterState {
  query: string;
  /** Keep only rows that lost the buybox. */
  buyboxLosers: boolean;
  /** Keep only rows whose discounted price still nets a profit (> 0). */
  profitable: boolean;
  /** Keep only rows whose discounted price makes a loss (< 0). */
  losing: boolean;
}

export const EMPTY_DISCOUNT_FILTERS: DiscountFilterState = {
  query: '',
  buyboxLosers: false,
  profitable: false,
  losing: false,
};

/** True when any chip or the search box is active — drives the table's "clear filters" CTA. */
export function hasActiveDiscountFilters(filters: DiscountFilterState): boolean {
  return (
    filters.query.trim() !== '' || filters.buyboxLosers || filters.profitable || filters.losing
  );
}

function matchesQuery(row: DiscountRow, needle: string): boolean {
  const haystack = [row.productTitle, row.barcode, row.modelCode]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLocaleLowerCase('tr');
  return haystack.includes(needle);
}

/** True when a scenario's (backend-computed) net profit is strictly positive — a sign check. */
function isProfitPositive(netProfit: string | null): boolean {
  return netProfit !== null && new Decimal(netProfit).gt(0);
}

function isProfitNegative(netProfit: string | null): boolean {
  return netProfit !== null && new Decimal(netProfit).lt(0);
}

/** Applies the search + chip filters to the row set (pure — no selection side effects). */
export function filterDiscountRows(
  rows: readonly DiscountRow[],
  filters: DiscountFilterState,
): DiscountRow[] {
  const needle = filters.query.trim().toLocaleLowerCase('tr');
  return rows.filter((row) => {
    if (needle !== '' && !matchesQuery(row, needle)) return false;
    if (filters.buyboxLosers && row.buyboxStatus !== BUYBOX_LOSER) return false;
    if (filters.profitable && !isProfitPositive(row.discounted.netProfit)) return false;
    if (filters.losing && !isProfitNegative(row.discounted.netProfit)) return false;
    return true;
  });
}

/**
 * The EXCLUSIVE "kârda kalanları seç" projection over the given rows: every row whose DISCOUNTED
 * price still nets a profit maps to `included: true`, and EVERY other row maps to `included: false`
 * — so applying it with mode 'set' both selects the winners and deselects the rest in one shot.
 * Callers pass the currently VISIBLE (filtered) rows, so hidden rows are absent and keep their
 * existing selection.
 */
export function profitableSelections(
  rows: readonly DiscountRow[],
): { itemId: string; included: boolean }[] {
  return rows.map((row) => ({
    itemId: row.id,
    included: isProfitPositive(row.discounted.netProfit),
  }));
}
