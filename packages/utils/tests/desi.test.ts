import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { SELLER_DESI_MAX_INCLUSIVE, SELLER_DESI_MIN_INCLUSIVE } from '../src/index';

// Owner rule (Berkin 2026-11-23): a seller-entered desi is at least 1.

describe('seller desi bounds', () => {
  it('are decimal strings with a floor of 1 and a ceiling of 999.99', () => {
    const min = new Decimal(SELLER_DESI_MIN_INCLUSIVE);
    const max = new Decimal(SELLER_DESI_MAX_INCLUSIVE);

    expect(min.equals(1)).toBe(true);
    expect(max.equals('999.99')).toBe(true);
    expect(min.lt(max)).toBe(true);
  });
});
