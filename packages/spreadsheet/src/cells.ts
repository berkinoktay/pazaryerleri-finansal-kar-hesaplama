// Readers for single cells of a `readWorkbookGrid` row (grid cells are
// `string | number | boolean | Date | null`), plus the header helpers the layouts use.
// Pure code: no I/O, no marketplace knowledge, no time-zone data (the caller injects
// the wall-clock -> instant conversion).

import { normalizeDecimalString } from './coerce';

/** One grid row. Callers pass rows they have not narrowed, so the cells stay unknown. */
export type CellRow = readonly unknown[];

/** A column position. Null or a negative number means the column is absent (the legacy -1 still works). */
export type ColumnIndex = number | null;

/** How a text cell is read as a decimal: `plain` is the strict form, `currency` also strips TL/₺/$/% noise. */
export type DecimalGrammar = 'plain' | 'currency';

/** `truncate` reads a decimal and drops the fraction; `strict` accepts only an unsigned digit string. */
export type IntMode = 'truncate' | 'strict';

/** A yes/no cell: true when the text equals `yes`, either exactly or after Turkish case folding. */
export interface FlagRule {
  readonly yes: string;
  readonly compare: 'exact' | 'casefold-tr';
}

/** The wall-clock text shapes a date cell may hold. */
export type WallClockPattern = 'dd/MM/yyyy HH:mm';

const DECIMAL_SHAPE = /^-?\d+(\.\d+)?$/;
const DOT_ONLY_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
const UNSIGNED_DIGITS = /^\d+$/;

function cellAt(row: CellRow, idx: ColumnIndex): unknown {
  if (idx === null || idx < 0) return undefined;
  return row[idx];
}

/**
 * A finite number in plain decimal notation, never exponent form ("1e-7" -> "0.0000001",
 * "1e+21" -> "1000000000000000000000"); `-0` gives "0". Equal to decimal.js
 * `new Decimal(n).toFixed()`, which only re-spells `String(n)`. Non-finite gives null.
 */
export function formatPlainDecimal(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  const exponentAt = text.indexOf('e');
  if (exponentAt < 0) return text;

  const negative = text.startsWith('-');
  const mantissa = text.slice(negative ? 1 : 0, exponentAt);
  const exponent = Number(text.slice(exponentAt + 1));
  const dotAt = mantissa.indexOf('.');
  const digits = dotAt < 0 ? mantissa : mantissa.slice(0, dotAt) + mantissa.slice(dotAt + 1);
  // Where the decimal point lands, counted in digits from the left of `digits`.
  const pointAt = (dotAt < 0 ? mantissa.length : dotAt) + exponent;

  let plain: string;
  if (pointAt <= 0) {
    plain = `0.${'0'.repeat(-pointAt)}${digits}`;
  } else if (pointAt >= digits.length) {
    plain = digits + '0'.repeat(pointAt - digits.length);
  } else {
    plain = `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  }
  return negative ? `-${plain}` : plain;
}

/** Trimmed string, or null for an empty/absent/non-textual cell. Numbers coerce to their string form. */
export function cellText(row: CellRow, idx: ColumnIndex): string | null {
  const value = cellAt(row, idx);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Plain grammar: Turkish-formatted strings ("1.234,56") are coerced defensively; a
 * plain dot decimal is kept as written.
 */
function plainDecimalText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  return DECIMAL_SHAPE.test(normalized) ? normalized : null;
}

/**
 * Currency grammar: strips ₺/$/% and a trailing "TL" before resolving Turkish
 * separators (via `normalizeDecimalString`), for TEXT cells like "250 ₺".
 */
function currencyDecimalText(raw: string): string | null {
  let normalized = normalizeDecimalString(raw);
  if (normalized === '') return null;
  // Turkish dot-only thousands ("1.250 ₺" -> 1250, "1.250.000 ₺" -> 1250000): after the
  // currency strip, a value with dots but NO comma whose every dot delimits a 3-digit group
  // is a thousands-formatted integer, not a decimal; strip the dots before validating.
  // normalizeDecimalString leaves a comma-less string's dots intact, so they survive to here.
  // A 2-digit tail like "1.25" fails this pattern and stays a decimal.
  if (DOT_ONLY_THOUSANDS.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }
  return DECIMAL_SHAPE.test(normalized) ? normalized : null;
}

const DECIMAL_TEXT_READERS: Record<DecimalGrammar, (raw: string) => string | null> = {
  plain: plainDecimalText,
  currency: currencyDecimalText,
};

/**
 * A decimal string ("777.1", "-4.12"), or null when the cell is empty/non-numeric.
 * A number cell is written in plain notation; a text cell is read with `grammar`.
 */
export function cellDecimal(
  row: CellRow,
  idx: ColumnIndex,
  grammar: DecimalGrammar,
): string | null {
  const value = cellAt(row, idx);
  if (typeof value === 'number') return formatPlainDecimal(value);
  if (typeof value === 'string') return DECIMAL_TEXT_READERS[grammar](value);
  return null;
}

/** An integer, or null when the cell is empty/non-numeric. See `IntMode`. */
export function cellInt(row: CellRow, idx: ColumnIndex, mode: IntMode): number | null {
  switch (mode) {
    case 'truncate': {
      const decimal = cellDecimal(row, idx, 'plain');
      return decimal === null ? null : Math.trunc(Number(decimal));
    }
    case 'strict': {
      const text = cellText(row, idx);
      return text !== null && UNSIGNED_DIGITS.test(text) ? Number(text) : null;
    }
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unhandled int mode: ${String(exhaustive)}`);
    }
  }
}

/** True when the cell text matches `rule.yes`; an absent or non-textual cell is false. */
export function cellFlag(row: CellRow, idx: ColumnIndex, rule: FlagRule): boolean {
  const text = cellText(row, idx);
  if (text === null) return false;
  switch (rule.compare) {
    case 'exact':
      return text === rule.yes;
    case 'casefold-tr':
      return text.toLocaleLowerCase('tr') === rule.yes.toLocaleLowerCase('tr');
    default: {
      const exhaustive: never = rule.compare;
      throw new Error(`Unhandled flag comparison: ${String(exhaustive)}`);
    }
  }
}

/** True when the cell reads as a non-zero truncated integer. */
export function cellNumericFlag(row: CellRow, idx: ColumnIndex): boolean {
  return (cellInt(row, idx, 'truncate') ?? 0) !== 0;
}

const DD_MM_YYYY_HH_MM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

/** "dd/MM/yyyy HH:mm" -> the wall clock as UTC milliseconds. No range check: 31/02 rolls into March. */
function parseDayMonthYearTime(text: string): number | null {
  const match = DD_MM_YYYY_HH_MM.exec(text);
  if (match === null) return null;
  const [, day, month, year, hour, minute] = match;
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

const WALL_CLOCK_PARSERS: Record<WallClockPattern, (text: string) => number | null> = {
  'dd/MM/yyyy HH:mm': parseDayMonthYearTime,
};

/**
 * The cell's wall clock as milliseconds, read as if it were UTC. A Date cell (which the
 * grid reader yields with the wall-clock components embedded as UTC) gives `getTime()`;
 * an Invalid Date gives null. A text cell is parsed with `pattern`; anything else is null.
 */
export function cellWallClock(
  row: CellRow,
  idx: ColumnIndex,
  pattern: WallClockPattern,
): number | null {
  const value = cellAt(row, idx);
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const text = cellText(row, idx);
  return text === null ? null : WALL_CLOCK_PARSERS[pattern](text);
}

/** The cell's wall clock turned into a true instant by the injected `toInstant`, or null. */
export function cellInstant(
  row: CellRow,
  idx: ColumnIndex,
  pattern: WallClockPattern,
  toInstant: (wallClockMs: number) => Date,
): Date | null {
  const wallClock = cellWallClock(row, idx, pattern);
  return wallClock === null ? null : toInstant(wallClock);
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
