import { describe, expect, it } from 'vitest';

import { parseSort, resolveSortIntent } from '@/features/commission-rates/lib/sort-options';

describe('parseSort', () => {
  it.each([
    ['category_name:asc', { column: 'categoryName', direction: 'asc' }],
    ['base_rate:asc', { column: 'baseRate', direction: 'asc' }],
    ['base_rate:desc', { column: 'baseRate', direction: 'desc' }],
    ['product_count:desc', { column: 'productCount', direction: 'desc' }],
  ] as const)('parses %s', (input, expected) => {
    expect(parseSort(input)).toEqual(expected);
  });
});

describe('resolveSortIntent', () => {
  it('clicking baseRate from default sort applies asc', () => {
    expect(
      resolveSortIntent({
        column: 'baseRate',
        currentSort: 'category_name:asc',
        productScope: 'all',
      }),
    ).toEqual({ sort: 'base_rate:asc', productScope: 'all', autoSwitchedScope: false });
  });

  it('clicking baseRate again toggles asc → desc', () => {
    expect(
      resolveSortIntent({
        column: 'baseRate',
        currentSort: 'base_rate:asc',
        productScope: 'all',
      }),
    ).toEqual({ sort: 'base_rate:desc', productScope: 'all', autoSwitchedScope: false });
  });

  it('clicking productCount in active mode does not flag autoSwitch', () => {
    expect(
      resolveSortIntent({
        column: 'productCount',
        currentSort: 'category_name:asc',
        productScope: 'active',
      }),
    ).toEqual({
      sort: 'product_count:desc',
      productScope: 'active',
      autoSwitchedScope: false,
    });
  });

  it('clicking productCount in all mode auto-switches to active and flags autoSwitch', () => {
    expect(
      resolveSortIntent({
        column: 'productCount',
        currentSort: 'category_name:asc',
        productScope: 'all',
      }),
    ).toEqual({
      sort: 'product_count:desc',
      productScope: 'active',
      autoSwitchedScope: true,
    });
  });

  it('clicking categoryName always returns asc with original scope', () => {
    expect(
      resolveSortIntent({
        column: 'categoryName',
        currentSort: 'product_count:desc',
        productScope: 'active',
      }),
    ).toEqual({
      sort: 'category_name:asc',
      productScope: 'active',
      autoSwitchedScope: false,
    });
  });
});
