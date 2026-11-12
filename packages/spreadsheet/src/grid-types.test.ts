import { describe, expect, it } from 'vitest';

import { isSheetData } from './grid-types';

describe('isSheetData', () => {
  it('accepts rows of strings, numbers, booleans, dates and nulls', () => {
    expect(isSheetData([['a', 1, true, new Date(0), null], []])).toBe(true);
    expect(isSheetData([])).toBe(true);
  });

  it('rejects a row with a hole', () => {
    const row: unknown[] = [];
    row[1] = 1;
    expect(isSheetData([row])).toBe(false);
  });

  it('rejects an undefined or object cell', () => {
    expect(isSheetData([['a', undefined]])).toBe(false);
    expect(isSheetData([[{ v: 1 }]])).toBe(false);
  });

  it('rejects a grid or row that is not an array', () => {
    expect(isSheetData('grid')).toBe(false);
    expect(isSheetData([['a'], 'b'])).toBe(false);
  });
});
