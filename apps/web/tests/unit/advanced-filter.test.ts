import { describe, expect, it } from 'vitest';

import {
  filterRowsToProductParams,
  PRODUCT_FILTER_FIELDS,
} from '@/features/products/lib/products-filter-fields';
import {
  convertRowValue,
  isFilterRowComplete,
  parseFilterRows,
  rangeBounds,
  type FilterRow,
} from '@/lib/advanced-filter';

function row(
  partial: Partial<FilterRow> & Pick<FilterRow, 'field' | 'operator' | 'value'>,
): FilterRow {
  return { id: partial.id ?? 'r1', ...partial };
}

describe('rangeBounds', () => {
  it('between → both bounds', () => {
    expect(rangeBounds(row({ field: 'x', operator: 'between', value: ['50', '90'] }))).toEqual([
      '50',
      '90',
    ]);
  });
  it('gte → min only', () => {
    expect(rangeBounds(row({ field: 'x', operator: 'gte', value: '50' }))).toEqual([
      '50',
      undefined,
    ]);
  });
  it('lte → max only', () => {
    expect(rangeBounds(row({ field: 'x', operator: 'lte', value: '90' }))).toEqual([
      undefined,
      '90',
    ]);
  });
  it('eq → both equal', () => {
    expect(rangeBounds(row({ field: 'x', operator: 'eq', value: '20' }))).toEqual(['20', '20']);
  });
  it('blank sides collapse to undefined (open range)', () => {
    expect(rangeBounds(row({ field: 'x', operator: 'between', value: ['', '90'] }))).toEqual([
      undefined,
      '90',
    ]);
  });
});

describe('filterRowsToProductParams', () => {
  it('maps a salePrice between to min+max decimal strings', () => {
    expect(
      filterRowsToProductParams([
        row({ field: PRODUCT_FILTER_FIELDS.salePrice, operator: 'between', value: ['50', '90'] }),
      ]),
    ).toEqual({ salePriceMin: '50', salePriceMax: '90' });
  });

  it('maps a salePrice gte to min only', () => {
    expect(
      filterRowsToProductParams([
        row({ field: PRODUCT_FILTER_FIELDS.salePrice, operator: 'gte', value: '50' }),
      ]),
    ).toEqual({ salePriceMin: '50' });
  });

  it('maps a stock range to numbers', () => {
    expect(
      filterRowsToProductParams([
        row({ field: PRODUCT_FILTER_FIELDS.stock, operator: 'between', value: ['10', '100'] }),
      ]),
    ).toEqual({ stockMin: 10, stockMax: 100 });
  });

  it('joins multi-selects to comma-separated strings (vat / brand / category)', () => {
    expect(
      filterRowsToProductParams([
        row({ field: PRODUCT_FILTER_FIELDS.vatRate, operator: 'in', value: ['10', '20'] }),
        row({ field: PRODUCT_FILTER_FIELDS.brand, operator: 'in', value: ['100', '200'] }),
        row({ field: PRODUCT_FILTER_FIELDS.category, operator: 'in', value: ['5'] }),
      ]),
    ).toEqual({ vatRateIn: '10,20', brandIdIn: '100,200', categoryIdIn: '5' });
  });

  it('contributes nothing for an incomplete (empty) chip', () => {
    expect(
      filterRowsToProductParams([
        row({ field: PRODUCT_FILTER_FIELDS.salePrice, operator: 'between', value: ['', ''] }),
        row({ field: PRODUCT_FILTER_FIELDS.vatRate, operator: 'in', value: [] }),
      ]),
    ).toEqual({});
  });

  it('drops a non-finite stock bound', () => {
    expect(
      filterRowsToProductParams([
        row({ field: PRODUCT_FILTER_FIELDS.stock, operator: 'gte', value: 'abc' }),
      ]),
    ).toEqual({});
  });
});

describe('parseFilterRows', () => {
  it('keeps valid rows', () => {
    const input = [{ id: 'a', field: 'salePrice', operator: 'between', value: ['50', '90'] }];
    expect(parseFilterRows(input)).toEqual(input);
  });

  it('drops entries with an unknown operator or non-string value member', () => {
    const input = [
      { id: 'a', field: 'x', operator: 'between', value: ['50'] },
      { id: 'b', field: 'x', operator: 'NOPE', value: '1' },
      { id: 'c', field: 'x', operator: 'in', value: [1, 2] },
      { id: 'd', field: 'x', operator: 'gte' }, // no value
    ];
    expect(parseFilterRows(input).map((r) => r.id)).toEqual(['a']);
  });

  it('returns [] for non-array input (hostile/stale URL)', () => {
    expect(parseFilterRows('garbage')).toEqual([]);
    expect(parseFilterRows(null)).toEqual([]);
  });
});

describe('isFilterRowComplete', () => {
  it('flag is complete when isTrue', () => {
    expect(isFilterRowComplete(row({ field: 'f', operator: 'isTrue', value: '' }), 'flag')).toBe(
      true,
    );
  });
  it('multi-select is complete only with a value', () => {
    expect(
      isFilterRowComplete(row({ field: 'f', operator: 'in', value: ['1'] }), 'enumMulti'),
    ).toBe(true);
    expect(isFilterRowComplete(row({ field: 'f', operator: 'in', value: [] }), 'enumMulti')).toBe(
      false,
    );
  });
  it('range is complete with at least one bound', () => {
    expect(isFilterRowComplete(row({ field: 'f', operator: 'gte', value: '5' }), 'money')).toBe(
      true,
    );
    expect(
      isFilterRowComplete(row({ field: 'f', operator: 'between', value: ['', ''] }), 'money'),
    ).toBe(false);
  });

  it('rejects a non-numeric money/number bound (would 422 the API silently)', () => {
    expect(isFilterRowComplete(row({ field: 'f', operator: 'gte', value: 'abc' }), 'money')).toBe(
      false,
    );
    expect(
      isFilterRowComplete(row({ field: 'f', operator: 'between', value: ['1.2.3', ''] }), 'money'),
    ).toBe(false);
    expect(
      isFilterRowComplete(row({ field: 'f', operator: 'between', value: ['50,90', ''] }), 'number'),
    ).toBe(false);
    expect(
      isFilterRowComplete(row({ field: 'f', operator: 'between', value: ['10', '100'] }), 'number'),
    ).toBe(true);
  });

  it('accepts a date bound without numeric validation', () => {
    expect(
      isFilterRowComplete(row({ field: 'd', operator: 'gte', value: '2026-01-01' }), 'date'),
    ).toBe(true);
  });
});

describe('convertRowValue (operator change preserves bound POSITION, never flips it)', () => {
  it('lte → between keeps the value as the MAX bound, not the min', () => {
    expect(convertRowValue(row({ field: 'p', operator: 'lte', value: '90' }), 'between')).toEqual([
      '',
      '90',
    ]);
  });

  it('gte → between keeps the value as the MIN bound', () => {
    expect(convertRowValue(row({ field: 'p', operator: 'gte', value: '50' }), 'between')).toEqual([
      '50',
      '',
    ]);
  });

  it('between → gte keeps the min; between → lte keeps the max', () => {
    const between = row({ field: 'p', operator: 'between', value: ['20', '400'] });
    expect(convertRowValue(between, 'gte')).toBe('20');
    expect(convertRowValue(between, 'lte')).toBe('400');
  });

  it('drops a bound that has no counterpart in the target shape (lte→gte, gte→lte)', () => {
    expect(convertRowValue(row({ field: 'p', operator: 'lte', value: '90' }), 'gte')).toBe('');
    expect(convertRowValue(row({ field: 'p', operator: 'gte', value: '50' }), 'lte')).toBe('');
  });

  it('eq → between expands to a closed [v, v] range', () => {
    expect(convertRowValue(row({ field: 'p', operator: 'eq', value: '20' }), 'between')).toEqual([
      '20',
      '20',
    ]);
  });

  it('text operators carry the raw scalar across the change', () => {
    expect(convertRowValue(row({ field: 't', operator: 'contains', value: 'abc' }), 'equals')).toBe(
      'abc',
    );
  });
});
