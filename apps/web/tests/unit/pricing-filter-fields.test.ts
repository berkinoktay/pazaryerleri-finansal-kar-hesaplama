import { describe, expect, it } from 'vitest';

import {
  pricingFilterParamsFromRows,
  pricingFilterRowsFromParams,
  type PricingAdvancedParams,
} from '@/features/product-pricing/lib/pricing-filter-fields';

const EMPTY: PricingAdvancedParams = {
  categoryId: '',
  brandId: '',
  marginMin: '',
  marginMax: '',
  lossOnly: false,
};

describe('pricing filter adapters', () => {
  it('emits no rows when nothing is filtered', () => {
    expect(pricingFilterRowsFromParams(EMPTY)).toEqual([]);
  });

  it('round-trips the full set', () => {
    const params: PricingAdvancedParams = {
      categoryId: 'c1',
      brandId: 'b1',
      marginMin: '10',
      marginMax: '40',
      lossOnly: true,
    };
    expect(pricingFilterParamsFromRows(pricingFilterRowsFromParams(params))).toEqual(params);
  });

  it('derives the margin operator from which bounds are present', () => {
    const minOnly = pricingFilterRowsFromParams({ ...EMPTY, marginMin: '10' });
    expect(minOnly).toEqual([{ id: 'margin', field: 'margin', operator: 'gte', value: '10' }]);
    const maxOnly = pricingFilterRowsFromParams({ ...EMPTY, marginMax: '40' });
    expect(maxOnly).toEqual([{ id: 'margin', field: 'margin', operator: 'lte', value: '40' }]);
    expect(pricingFilterParamsFromRows(minOnly)).toEqual({ ...EMPTY, marginMin: '10' });
    expect(pricingFilterParamsFromRows(maxOnly)).toEqual({ ...EMPTY, marginMax: '40' });
  });

  it('emits explicit empty values for absent rows so removing a chip clears its param', () => {
    expect(pricingFilterParamsFromRows([])).toEqual(EMPTY);
  });
});
