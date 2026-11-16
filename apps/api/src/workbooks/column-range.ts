// A number or a date read from the uploaded file that its database column cannot hold.
// The upload refuses it as a MALFORMED_SHEET on `file` (a 422), never a 500: before the
// write where the checks below can see it, at the insert (Prisma P2020, mapped in
// import-workbook.ts) where only the database can.

import { SpreadsheetFileError } from '@pazarsync/spreadsheet';
import { STORABLE_YEAR_MAX, STORABLE_YEAR_MIN } from '@pazarsync/utils';

/** `meta.reason` of the MALFORMED_SHEET a value out of range for its column answers. */
export const VALUE_OUT_OF_RANGE_REASON = 'value-out-of-range';

/**
 * `meta.reason` of the MALFORMED_SHEET any other value its column cannot store answers:
 * a Postgres data exception (SQLSTATE class 22) at the insert that no check before the
 * write covers (mapped in import-workbook.ts).
 */
export const VALUE_NOT_STORABLE_REASON = 'value-not-storable';

// The range of the Postgres `integer` (int4) type, the type of a Prisma `Int` column.
// Prisma refuses a number past the 64-bit range before the query (a validation error
// with no code, a 500), and Postgres refuses one past this range at the insert.
export const POSTGRES_INTEGER_MIN = -2147483648;
export const POSTGRES_INTEGER_MAX = 2147483647;

/**
 * `value`, an integer `reader.int` read for a Postgres `integer` column, unchanged when
 * it is null or within POSTGRES_INTEGER_MIN..POSTGRES_INTEGER_MAX.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason VALUE_OUT_OF_RANGE_REASON), a 422
 * on `file` at upload, for any other number (an infinite one included). The value never
 * appears in the message.
 */
export function requireStorableInt(value: number | null): number | null {
  if (value === null) return null;
  if (value >= POSTGRES_INTEGER_MIN && value <= POSTGRES_INTEGER_MAX) return value;
  throw new SpreadsheetFileError(
    'MALFORMED_SHEET',
    'A file integer is out of range for its integer column',
    { reason: VALUE_OUT_OF_RANGE_REASON },
  );
}

/**
 * Whether `value` is a valid date whose UTC year is within
 * STORABLE_YEAR_MIN..STORABLE_YEAR_MAX (`@pazarsync/utils`): the one copy of the range a
 * stored instant may have, for a date read from a file and a date a seller typed alike.
 */
export function isStorableYear(value: Date): boolean {
  const year = value.getUTCFullYear();
  // An invalid date's year is NaN, outside every range.
  return year >= STORABLE_YEAR_MIN && year <= STORABLE_YEAR_MAX;
}

/**
 * `value`, a date a format read for a timestamp column, unchanged when it is null or a
 * valid date whose UTC year is within STORABLE_YEAR_MIN..STORABLE_YEAR_MAX.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason VALUE_OUT_OF_RANGE_REASON), a 422
 * on `file` at upload, for an invalid date or any other year. The value never appears
 * in the message.
 */
export function requireStorableInstant(value: Date | null): Date | null {
  if (value === null) return null;
  if (isStorableYear(value)) return value;
  throw new SpreadsheetFileError(
    'MALFORMED_SHEET',
    'A file date is out of range for its timestamp column',
    { reason: VALUE_OUT_OF_RANGE_REASON },
  );
}
