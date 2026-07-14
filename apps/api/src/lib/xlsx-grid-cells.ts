// Shared readers + header helpers for a `readWorkbookGrid` result (grid cells are
// `string | number | boolean | Date | null`). Used by every campaign-tariff
// import/export/layout path so they read Trendyol's cells identically.

import { normalizeDecimalString } from '@pazarsync/spreadsheet';

/** Trimmed string, or null for an empty/absent/non-textual cell. Numbers coerce to their string form. */
export function cellText(row: readonly unknown[], idx: number): string | null {
  const value = row[idx];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * A decimal string ("777.1", "-4.12"), or null when the cell is empty/non-numeric.
 * Turkish-formatted strings ("1.234,56") are coerced defensively; a plain dot
 * decimal is kept. The cells are usually already numeric.
 */
export function cellDecimalString(row: readonly unknown[], idx: number): string | null {
  const value = row[idx];
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  }
  return null;
}

/**
 * Like `cellDecimalString`, but currency-aware: strips ₺/$/% and a trailing "TL"
 * before resolving Turkish separators (via the spreadsheet package's shared
 * normalizer). Needed by the Discounts sheet, whose "Güncel Satış Fiyatı" column
 * is TEXT like "250 ₺" — `cellDecimalString` would reject it.
 */
export function cellCurrencyDecimalString(row: readonly unknown[], idx: number): string | null {
  const value = row[idx];
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') {
    const normalized = normalizeDecimalString(value);
    if (normalized === '') return null;
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  }
  return null;
}

/** An integer, or null when the cell is empty/non-numeric. Truncates a decimal. */
export function cellInt(row: readonly unknown[], idx: number): number | null {
  const decimal = cellDecimalString(row, idx);
  return decimal === null ? null : Math.trunc(Number(decimal));
}

/**
 * Normalizes a header value for exact comparison: NFC-normalize + trim + collapse
 * internal whitespace (JS `\s` already covers NBSP U+00A0), so header matching is
 * exact regardless of stray spacing.
 */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Index of a header in an ALREADY-normalized header row, or -1 when absent. */
export function findHeader(normalizedHeaders: readonly string[], target: string): number {
  return normalizedHeaders.indexOf(normalizeHeader(target));
}
