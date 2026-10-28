import Decimal from 'decimal.js';

import { parseTrDecimal } from '@/lib/parse-tr-decimal';

import type { DimensionalWeightErrorCode } from './dimensional-weight-errors';

// Client-side twin of the backend desi validation, so a typo is caught inline
// before any request. The bounds mirror DIMENSIONAL_WEIGHT_MIN_INCLUSIVE /
// DIMENSIONAL_WEIGHT_MAX_INCLUSIVE and the 2-fraction-digit regex in
// apps/api/src/validators/product.validator.ts; the backend stays the
// authority and answers with the same codes.
const DESI_MIN_INCLUSIVE = new Decimal(0);
const DESI_MAX_INCLUSIVE = new Decimal('999.99');
const DESI_MAX_FRACTION_DIGITS = 2;

export type DesiInputResult =
  /** Nothing typed: the popover clears the override, the bulk dialog refuses. */
  | { kind: 'empty' }
  /**
   * `payload` is the canonical dot string the PATCH body carries ("1,5" -> "1.5"):
   * plain notation, never an exponent, trailing zeros dropped.
   */
  | { kind: 'valid'; value: Decimal; payload: string }
  | { kind: 'invalid'; code: DimensionalWeightErrorCode };

// Counts the fraction digits as typed. decimal.js drops trailing zeros, so
// value.decimalPlaces() would let "1.500" through as 1.5 although a Turkish
// reader may mean 1500; any input with 3+ typed fraction digits is a format
// error, the same as "1.234". parseTrDecimal already allows one separator only.
function typedFractionDigits(raw: string): number {
  const trimmed = raw.trim();
  const separatorIndex = Math.max(trimmed.lastIndexOf(','), trimmed.lastIndexOf('.'));
  return separatorIndex === -1 ? 0 : trimmed.length - separatorIndex - 1;
}

/**
 * Parse what a seller typed into a desi field. Desi uses the no-grouping
 * Turkish mode: a single ',' or '.' is the decimal separator, so "1,5" and
 * "1.5" both mean 1.5 (desi never reaches the thousands, so there is no
 * grouping to misread). Shared by the desi popover and the bulk desi dialog.
 */
export function parseDesiInput(raw: string): DesiInputResult {
  if (raw.trim() === '') return { kind: 'empty' };

  const value = parseTrDecimal(raw, { grouping: false });
  if (value === null || typedFractionDigits(raw) > DESI_MAX_FRACTION_DIGITS) {
    return { kind: 'invalid', code: 'INVALID_DIMENSIONAL_WEIGHT_FORMAT' };
  }
  if (value.lt(DESI_MIN_INCLUSIVE)) {
    return { kind: 'invalid', code: 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL' };
  }
  if (value.gt(DESI_MAX_INCLUSIVE)) {
    return { kind: 'invalid', code: 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE' };
  }
  // toFixed() prints plain notation; a typed "-0" prints as "0".
  return { kind: 'valid', value, payload: value.toFixed() };
}
