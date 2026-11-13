import { describe, expect, it } from 'vitest';

import { PATCH_ERROR_ROW_SAMPLE } from '../constants';
import { RejectedRows } from './rejected-rows';

describe('RejectedRows', () => {
  it('keeps the smallest distinct rows ascending and counts every row', () => {
    const rejected = new RejectedRows();
    for (const row of [30, 5, 5, 20, 1, 30, 7, 2, 40, 3, 50, 4, 6, 8, 9, 10, 11]) {
      rejected.add(row);
    }
    expect(rejected.count).toBe(17);
    expect(rejected.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rejected.rows).toHaveLength(PATCH_ERROR_ROW_SAMPLE);
  });

  it('ignores a row above a full sample and a repeat of a kept row', () => {
    const rejected = new RejectedRows();
    for (let row = 1; row <= PATCH_ERROR_ROW_SAMPLE; row += 1) rejected.add(row);
    rejected.add(PATCH_ERROR_ROW_SAMPLE + 1);
    rejected.add(PATCH_ERROR_ROW_SAMPLE);
    expect(rejected.count).toBe(PATCH_ERROR_ROW_SAMPLE + 2);
    expect(rejected.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
