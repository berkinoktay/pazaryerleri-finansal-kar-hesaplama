import { describe, expect, it } from 'vitest';

import { computeProductAggregates } from '../upsert-catalog-batch';

describe('computeProductAggregates — denormalized Product.totalStock + min/maxSalePrice', () => {
  it('sums quantities and spans the sale prices across multiple variants (2-dp strings)', () => {
    expect(
      computeProductAggregates([
        { quantity: 7, salePrice: '149.90' },
        { quantity: 13, salePrice: '89.50' },
        { quantity: 5, salePrice: '249.00' },
      ]),
    ).toEqual({ totalStock: 25, minSalePrice: '89.50', maxSalePrice: '249.00' });
  });

  it('returns min === max for a single variant', () => {
    expect(computeProductAggregates([{ quantity: 3, salePrice: '57.30' }])).toEqual({
      totalStock: 3,
      minSalePrice: '57.30',
      maxSalePrice: '57.30',
    });
  });

  it('returns totalStock 0 and null bounds for a content with no variants', () => {
    expect(computeProductAggregates([])).toEqual({
      totalStock: 0,
      minSalePrice: null,
      maxSalePrice: null,
    });
  });

  it('compares prices numerically, not lexically (9.00 < 100.00)', () => {
    // A string sort would put '100.00' before '9.00' and pick the wrong min.
    expect(
      computeProductAggregates([
        { quantity: 1, salePrice: '100.00' },
        { quantity: 1, salePrice: '9.00' },
      ]),
    ).toEqual({ totalStock: 2, minSalePrice: '9.00', maxSalePrice: '100.00' });
  });

  it('preserves 2-dp precision on close values', () => {
    expect(
      computeProductAggregates([
        { quantity: 1, salePrice: '10.05' },
        { quantity: 1, salePrice: '10.50' },
      ]),
    ).toEqual({ totalStock: 2, minSalePrice: '10.05', maxSalePrice: '10.50' });
  });

  it('treats a 0.00 variant (missing-price default) as the low bound, not as absent', () => {
    expect(
      computeProductAggregates([
        { quantity: 1, salePrice: '0.00' },
        { quantity: 1, salePrice: '50.00' },
      ]),
    ).toEqual({ totalStock: 2, minSalePrice: '0.00', maxSalePrice: '50.00' });
  });
});
