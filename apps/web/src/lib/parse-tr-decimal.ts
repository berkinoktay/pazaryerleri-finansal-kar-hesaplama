import Decimal from 'decimal.js';

/**
 * Shared tr-TR decimal parsing and formatting for editable numeric fields
 * (money, percentages, desi). Locale-fixed on purpose: the input convention is
 * Turkish regardless of the UI locale, so an en-locale formatter never prints
 * "1.5" into a field whose parser reads '.' as a thousands separator.
 *
 * Lives in `@/lib` because both a shared pattern (MoneyInput / PercentageInput)
 * and the products feature (desi input) parse the same way.
 */

export interface ParseTrDecimalOptions {
  /**
   * `true` (money): '.' is a thousands separator and is dropped, the first ','
   * is the decimal separator ("1.234,5" is 1234.5, "1.5" is 15).
   * `false` (desi): no thousands separators; a single ',' OR a single '.' is
   * the decimal separator ("1,5" and "1.5" are both 1.5, "1.234,5" is invalid).
   */
  grouping: boolean;
}

/**
 * The only shape handed to `new Decimal`: an optional leading sign, then
 * digits with at most one '.' (a leading or trailing '.' is allowed so an
 * in-progress buffer such as "1," still parses). Whitelisting here keeps the
 * forms `new Decimal` would otherwise accept (exponents "1e3", hex "0x10",
 * binary/octal, "Infinity", "NaN") out of every numeric field.
 */
const PLAIN_DECIMAL = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

const DECIMAL_SEPARATOR_PATTERN = /[.,]/g;

const DEFAULT_MAX_FRACTION_DIGITS = 2;

function toDotNotation(trimmed: string, grouping: boolean): string | null {
  if (grouping) {
    // Drop every thousands separator, then the first ',' becomes the decimal
    // point. A second ',' survives and fails the whitelist.
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  const separatorCount = trimmed.match(DECIMAL_SEPARATOR_PATTERN)?.length ?? 0;
  if (separatorCount > 1) return null;
  return trimmed.replace(',', '.');
}

/**
 * Parse a tr-TR numeric string into a Decimal. Returns `null` for empty or
 * unparseable input so callers can tell "user cleared the field" from "user
 * typed 0". The sign passes through and every fraction digit is kept: range
 * and scale checks belong to the caller.
 */
export function parseTrDecimal(input: string, options: ParseTrDecimalOptions): Decimal | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const normalized = toDotNotation(trimmed, options.grouping);
  if (normalized === null || !PLAIN_DECIMAL.test(normalized)) return null;
  return new Decimal(normalized);
}

/**
 * Format a decimal (a Decimal or an API dot string such as "1.50") as a
 * tr-TR editing string: comma decimal separator, no thousands grouping, no
 * exponent, at most `maxFractionDigits` fraction digits (half-up rounding,
 * trailing zeros dropped). "1.50" -> "1,5", "3" -> "3".
 *
 * Decimal math end to end, never `toNumber()`, so large or long values do not
 * drift. Throws a DecimalError when a string is not a number; callers pass
 * backend-served decimal strings.
 */
export function formatTrDecimal(
  value: string | Decimal,
  maxFractionDigits: number = DEFAULT_MAX_FRACTION_DIGITS,
): string {
  const decimal = typeof value === 'string' ? new Decimal(value) : value;
  // toFixed() with no argument prints plain notation (never an exponent) and,
  // after toDecimalPlaces, no trailing zeros. A rounded negative zero prints "0".
  const plain = decimal.toDecimalPlaces(maxFractionDigits, Decimal.ROUND_HALF_UP).toFixed();
  return plain.replace('.', ',');
}
