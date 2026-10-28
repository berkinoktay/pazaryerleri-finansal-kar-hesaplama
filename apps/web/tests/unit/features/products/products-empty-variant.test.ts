import { describe, expect, it } from 'vitest';

import {
  pageToStepBackTo,
  resolveProductsEmptyVariant,
} from '@/features/products/lib/products-empty-variant';

// Which empty state the products table shows. The all-clear copy of an
// override tab ("every product has a cost / desi") is only true when nothing
// else narrows the list, so an active search or filter chip wins and shows
// the filtered no-results state with its "Clear filters" button. An empty
// page of a list that still has rows shows no empty-state copy at all.

describe('resolveProductsEmptyVariant', () => {
  it('returns undefined while the list is not empty', () => {
    expect(
      resolveProductsEmptyVariant({
        isEmptyAfterLoad: false,
        total: 3,
        overrideMissing: 'desi',
        hasActiveSearchOrFilter: false,
      }),
    ).toBeUndefined();
  });

  it.each([
    ['cost', 'missing-cost-none'],
    ['desi', 'missing-desi-none'],
  ] as const)(
    'shows the all-clear state of the %s tab when nothing else is active',
    (tab, variant) => {
      expect(
        resolveProductsEmptyVariant({
          isEmptyAfterLoad: true,
          total: 0,
          overrideMissing: tab,
          hasActiveSearchOrFilter: false,
        }),
      ).toBe(variant);
    },
  );

  it.each(['cost', 'desi', null] as const)(
    'prefers the filtered state on the %s tab when a search or filter is active',
    (tab) => {
      expect(
        resolveProductsEmptyVariant({
          isEmptyAfterLoad: true,
          total: 0,
          overrideMissing: tab,
          hasActiveSearchOrFilter: true,
        }),
      ).toBe('filtered');
    },
  );

  it('shows the no-products state on the all tab with nothing active', () => {
    expect(
      resolveProductsEmptyVariant({
        isEmptyAfterLoad: true,
        total: 0,
        overrideMissing: null,
        hasActiveSearchOrFilter: false,
      }),
    ).toBe('no-products');
  });

  // The seller emptied page 2 of the desi tab: the page is empty but 25
  // products still miss desi, so "every product has a desi" would be false.
  it.each(['cost', 'desi', null] as const)(
    'shows no empty state on the %s tab for an empty page of a non-empty list',
    (tab) => {
      expect(
        resolveProductsEmptyVariant({
          isEmptyAfterLoad: true,
          total: 25,
          overrideMissing: tab,
          hasActiveSearchOrFilter: false,
        }),
      ).toBeUndefined();
    },
  );
});

describe('pageToStepBackTo', () => {
  it('steps back to the new last page when the requested page came back empty', () => {
    expect(pageToStepBackTo({ page: 2, rowCount: 0, totalPages: 1 })).toBe(1);
    expect(pageToStepBackTo({ page: 9, rowCount: 0, totalPages: 4 })).toBe(4);
  });

  it('keeps a page that has rows', () => {
    expect(pageToStepBackTo({ page: 2, rowCount: 5, totalPages: 2 })).toBeNull();
  });

  it('keeps the page when the whole list is empty (the empty state takes over)', () => {
    expect(pageToStepBackTo({ page: 3, rowCount: 0, totalPages: 0 })).toBeNull();
  });

  it('keeps an empty page that is not past the last one', () => {
    expect(pageToStepBackTo({ page: 1, rowCount: 0, totalPages: 1 })).toBeNull();
  });
});
