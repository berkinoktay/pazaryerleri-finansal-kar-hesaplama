// Shared readers + header helpers for a `readWorkbookGrid` result (grid cells are
// `string | number | boolean | Date | null`). Used by every campaign-tariff
// import/export/layout path so they read Trendyol's cells identically.
//
// A thin shim over the engine's cell readers (`@pazarsync/spreadsheet` cells.ts) that
// keeps the names the services import today. Named wrappers, not `export *`: the
// engine's `cellInt` takes a mode, and the engine's other exports do not belong here.

import { cellDecimal, cellInt as cellIntByMode } from '@pazarsync/spreadsheet';

export { cellText, findHeader, normalizeHeader } from '@pazarsync/spreadsheet';

/**
 * A decimal string ("777.1", "-4.12"), or null when the cell is empty/non-numeric.
 * Turkish-formatted strings ("1.234,56") are coerced defensively; a plain dot
 * decimal is kept. The cells are usually already numeric.
 */
export function cellDecimalString(row: readonly unknown[], idx: number): string | null {
  return cellDecimal(row, idx, 'plain');
}

/**
 * Like `cellDecimalString`, but currency-aware: strips ₺/$/% and a trailing "TL"
 * before resolving Turkish separators. Needed by the Discounts sheet, whose
 * "Güncel Satış Fiyatı" column is TEXT like "250 ₺"; `cellDecimalString` would reject it.
 */
export function cellCurrencyDecimalString(row: readonly unknown[], idx: number): string | null {
  return cellDecimal(row, idx, 'currency');
}

/** An integer, or null when the cell is empty/non-numeric. Truncates a decimal. */
export function cellInt(row: readonly unknown[], idx: number): number | null {
  return cellIntByMode(row, idx, 'truncate');
}
