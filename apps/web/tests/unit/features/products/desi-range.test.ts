import { describe, expect, it } from 'vitest';

import { desiRange } from '@/features/products/lib/format-product';

import { MISSING_DESI_FIELDS, makeVariantSummary } from '../../../helpers/product-fixtures';

// desiRange feeds the multi-variant parent row's desi column. It skips variants
// with no desi (the backend flags them missing), counts a desi of 0 as a real
// desi, and formats the bounds the Turkish way.

const missing = (id: string) => makeVariantSummary({ id, ...MISSING_DESI_FIELDS });

const withDesi = (id: string, value: string, overridden = false) =>
  makeVariantSummary({
    id,
    dimensionalWeight: value,
    syncedDimensionalWeight: overridden ? '0' : value,
    isDimensionalWeightOverridden: overridden,
    isDimensionalWeightMissing: false,
  });

describe('desiRange', () => {
  it('returns null for no variants', () => {
    expect(desiRange([])).toBeNull();
  });

  it('returns null when every variant misses desi', () => {
    expect(desiRange([missing('a'), missing('b')])).toBeNull();
  });

  it('skips missing variants and formats the bounds with a comma', () => {
    expect(desiRange([missing('a'), withDesi('b', '1.50'), withDesi('c', '3.00')])).toEqual({
      min: '1,5',
      max: '3',
      isSingle: false,
      anyOverridden: false,
    });
  });

  it('reports a single value when every known desi is equal', () => {
    expect(desiRange([withDesi('a', '2.00'), withDesi('b', '2')])).toEqual({
      min: '2',
      max: '2',
      isSingle: true,
      anyOverridden: false,
    });
  });

  it('counts an explicit override of 0 as a real desi and flags the override', () => {
    expect(desiRange([withDesi('a', '0', true), withDesi('b', '2.5')])).toEqual({
      min: '0',
      max: '2,5',
      isSingle: false,
      anyOverridden: true,
    });
  });

  it('counts a stored desi of 0 as a real desi', () => {
    expect(desiRange([missing('a'), withDesi('b', '0'), withDesi('c', '2')])).toEqual({
      min: '0',
      max: '2',
      isSingle: false,
      anyOverridden: false,
    });
  });

  it('compares as decimals, not strings ("10" is above "9")', () => {
    const range = desiRange([withDesi('a', '10.00'), withDesi('b', '9.25')]);
    expect(range?.min).toBe('9,25');
    expect(range?.max).toBe('10');
  });
});
