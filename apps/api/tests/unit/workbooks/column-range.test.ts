import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpreadsheetFileError } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { ValidationError } from '@/lib/errors';
import { problemDetailsForError } from '@/lib/problem-details';
import {
  POSTGRES_INTEGER_MAX,
  POSTGRES_INTEGER_MIN,
  requireStorableInt,
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
