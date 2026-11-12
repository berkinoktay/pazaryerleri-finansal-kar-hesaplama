import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_MAX_BYTES,
  ABSOLUTE_MAX_COLS,
  ABSOLUTE_MAX_ROWS,
  DEFAULT_COL_CAP,
  DEFAULT_MAX_BYTES,
  DEFAULT_ROW_CAP,
} from './constants';
import { resolveReadOptions } from './read-options';

describe('resolveReadOptions', () => {
  it('fills in the default limits', () => {
    expect(resolveReadOptions({ sheetName: 'S' })).toEqual({
      sheetName: 'S',
      rowCap: DEFAULT_ROW_CAP,
      colCap: DEFAULT_COL_CAP,
      maxBytes: DEFAULT_MAX_BYTES,
    });
  });

  it('keeps an override below its ceiling', () => {
    expect(resolveReadOptions({ rowCap: 1, colCap: 2, maxBytes: 3 })).toMatchObject({
      rowCap: 1,
      colCap: 2,
      maxBytes: 3,
    });
  });

  it('clamps an override above its ceiling', () => {
    expect(
      resolveReadOptions({
        rowCap: ABSOLUTE_MAX_ROWS + 1,
        colCap: ABSOLUTE_MAX_COLS + 1,
        maxBytes: ABSOLUTE_MAX_BYTES + 1,
      }),
    ).toMatchObject({
      rowCap: ABSOLUTE_MAX_ROWS,
      colCap: ABSOLUTE_MAX_COLS,
      maxBytes: ABSOLUTE_MAX_BYTES,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])(
    'falls back to the default for %s instead of switching a cap off',
    (bad) => {
      expect(resolveReadOptions({ rowCap: bad, colCap: bad, maxBytes: bad })).toMatchObject({
        rowCap: DEFAULT_ROW_CAP,
        colCap: DEFAULT_COL_CAP,
        maxBytes: DEFAULT_MAX_BYTES,
      });
    },
  );

  it('carries a sheet selector', () => {
    expect(resolveReadOptions({ sheet: { by: 'name', name: 'Veri' } })).toMatchObject({
      sheet: { by: 'name', name: 'Veri' },
    });
    expect(resolveReadOptions({ sheet: { by: 'index', index: 0 } })).toMatchObject({
      sheet: { by: 'index', index: 0 },
    });
  });

  it('throws when both a sheet selector and a sheet name are given', () => {
    expect(() =>
      resolveReadOptions({ sheet: { by: 'index', index: 0 }, sheetName: 'Veri' }),
    ).toThrow(Error);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws for the sheet index %s',
    (bad) => {
      expect(() => resolveReadOptions({ sheet: { by: 'index', index: bad } })).toThrow(Error);
    },
  );
});
