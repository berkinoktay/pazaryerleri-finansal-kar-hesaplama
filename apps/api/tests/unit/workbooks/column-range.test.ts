import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpreadsheetFileError } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { ValidationError } from '@/lib/errors';
import { problemDetailsForError } from '@/lib/problem-details';
import {
  POSTGRES_INTEGER_MAX,
  POSTGRES_INTEGER_MIN,
  requireStorableInstant,
  requireStorableInt,
  STORABLE_YEAR_MAX,
  STORABLE_YEAR_MIN,
  VALUE_OUT_OF_RANGE_REASON,
} from '@/workbooks/column-range';
import { toUploadError } from '@/workbooks/workbook-errors';

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requireStorableInt', () => {
  it('holds the range of the Postgres integer type', () => {
    expect([POSTGRES_INTEGER_MIN, POSTGRES_INTEGER_MAX]).toEqual([-2147483648, 2147483647]);
  });

  it.each([
    ['null', null],
    ['0', 0],
    ['the lower bound', -2147483648],
    ['the upper bound', 2147483647],
  ])('returns %s unchanged', (_name, value) => {
    expect(requireStorableInt(value)).toBe(value);
  });

  it.each([
    ['one above the upper bound', 2147483648],
    ['one below the lower bound', -2147483649],
    ['3e9', 3e9],
    ['1e20', 1e20],
    ['-1e20', -1e20],
    ['an infinite number', Number.POSITIVE_INFINITY],
  ])(
    'refuses %s with MALFORMED_SHEET value-out-of-range, the value kept out of the message',
    (_name, value) => {
      const err = captureThrow(() => requireStorableInt(value));

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: VALUE_OUT_OF_RANGE_REASON });
      expect(err.meta['reason']).toBe('value-out-of-range');
      expect(err.message).not.toContain(String(value));
    },
  );

  it('is a 422 on `file` at upload, never a 500', () => {
    vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
    const err = captureThrow(() => requireStorableInt(3e9));

    const mapped = captureThrow(() =>
      toUploadError(err, {}, { page: WORKBOOK_PAGES.COMMISSION_TARIFF }),
    );
    expect(mapped).toBeInstanceOf(ValidationError);
    if (!(mapped instanceof ValidationError)) return;
    expect(mapped.issues).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    expect(problemDetailsForError(mapped).status).toBe(422);
  });
});

describe('requireStorableInstant', () => {
  it('holds the years a stored instant may have', () => {
    expect([STORABLE_YEAR_MIN, STORABLE_YEAR_MAX]).toEqual([1900, 9999]);
  });

  it('passes null', () => {
    expect(requireStorableInstant(null)).toBeNull();
  });

  it.each([
    ['the first instant of 1900', '1900-01-01T00:00:00.000Z'],
    ['the last instant of 9999', '9999-12-31T23:59:59.999Z'],
    ['a 2026 window start', '2026-07-07T21:00:00.000Z'],
  ])('returns %s unchanged', (_name, iso) => {
    const value = new Date(iso);

    expect(requireStorableInstant(value)).toBe(value);
  });

  it.each([
    ['the last instant of 1899', new Date('1899-12-31T23:59:59.999Z')],
    ['the first instant of the year 10000', new Date('+010000-01-01T00:00:00.000Z')],
    ['the year 50', new Date('0050-07-08T00:00:00.000Z')],
    ['a year before 1 AD', new Date('-000001-07-08T00:00:00.000Z')],
    ['an invalid date', new Date(Number.NaN)],
  ])(
    'refuses %s with MALFORMED_SHEET value-out-of-range, the value kept out of the message',
    (_name, value) => {
      const err = captureThrow(() => requireStorableInstant(value));

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: VALUE_OUT_OF_RANGE_REASON });
      expect(err.message).not.toContain(String(value.getUTCFullYear()));
    },
  );
});
