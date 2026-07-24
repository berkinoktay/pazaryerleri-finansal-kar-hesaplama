import { describe, expect, it } from 'vitest';

import type { DiscountRow, DiscountScenario } from '@/features/campaigns/lib/adapt-discount-list';
import {
  EMPTY_DISCOUNT_FILTERS,
  filterDiscountRows,
  hasActiveDiscountFilters,
  profitableSelections,
  type DiscountFilterState,
} from '@/features/campaigns/lib/discount-selection';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function scenario(netProfit: string | null): DiscountScenario {
  return {
    price: '100.00',
    commissionPct: '20',
    commissionSource: 'band',
    netProfit,
    marginPct: netProfit,
  };
}

/**
 * Minimal DiscountRow factory. `discountedNetProfit` drives the profitable/losing sign checks;
 * the search fields are overridable for query tests.
 */
function makeRow(
  overrides: Partial<{
    id: string;
    productTitle: string;
    barcode: string;
    modelCode: string | null;
    discountedNetProfit: string | null;
  }> = {},
): DiscountRow {
  const {
    id = 'row-1',
    productTitle = 'Kablosuz Kulaklık',
    barcode = 'BARCODE-1',
    modelCode = 'MODEL-1',
    discountedNetProfit = '10.00',
  } = overrides;
  return {
    id,
    barcode,
    modelCode,
    externalId: null,
    productTitle,
    brand: null,
    color: null,
    imageUrl: null,
    calculable: true,
    reason: null,
    current: scenario('25.00'),
    discounted: scenario(discountedNetProfit),
    commissionBands: null,
  };
}

function filters(overrides: Partial<DiscountFilterState> = {}): DiscountFilterState {
  return { ...EMPTY_DISCOUNT_FILTERS, ...overrides };
}

// ─── hasActiveDiscountFilters ─────────────────────────────────────────────────

describe('hasActiveDiscountFilters', () => {
  it('is false for the empty filter state', () => {
    expect(hasActiveDiscountFilters(EMPTY_DISCOUNT_FILTERS)).toBe(false);
  });

  it('is false when the query is only whitespace', () => {
    expect(hasActiveDiscountFilters(filters({ query: '   ' }))).toBe(false);
  });

  it('is true when the query has content', () => {
    expect(hasActiveDiscountFilters(filters({ query: 'kulak' }))).toBe(true);
  });

  it('is true when any chip is active', () => {
    expect(hasActiveDiscountFilters(filters({ profitable: true }))).toBe(true);
    expect(hasActiveDiscountFilters(filters({ losing: true }))).toBe(true);
  });
});

// ─── filterDiscountRows ───────────────────────────────────────────────────────

describe('filterDiscountRows', () => {
  it('returns every row when no filter is active', () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
    expect(filterDiscountRows(rows, EMPTY_DISCOUNT_FILTERS)).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(filterDiscountRows([], filters({ profitable: true }))).toEqual([]);
  });

  describe('profitable chip', () => {
    it('keeps rows with a strictly positive discounted net profit and drops null / non-positive', () => {
      const rows = [
        makeRow({ id: 'pos', discountedNetProfit: '5.00' }),
        makeRow({ id: 'zero', discountedNetProfit: '0' }),
        makeRow({ id: 'neg', discountedNetProfit: '-3.00' }),
        makeRow({ id: 'null', discountedNetProfit: null }),
      ];
      const kept = filterDiscountRows(rows, filters({ profitable: true }));
      expect(kept.map((r) => r.id)).toEqual(['pos']);
    });
  });

  describe('losing chip', () => {
    it('keeps rows with a strictly negative discounted net profit and drops null / non-negative', () => {
      const rows = [
        makeRow({ id: 'pos', discountedNetProfit: '5.00' }),
        makeRow({ id: 'zero', discountedNetProfit: '0' }),
        makeRow({ id: 'neg', discountedNetProfit: '-3.00' }),
        makeRow({ id: 'null', discountedNetProfit: null }),
      ];
      const kept = filterDiscountRows(rows, filters({ losing: true }));
      expect(kept.map((r) => r.id)).toEqual(['neg']);
    });
  });

  describe('query filter', () => {
    it('matches case-insensitively against title, barcode and model code', () => {
      const rows = [
        makeRow({ id: 'title', productTitle: 'Bluetooth Hoparlör', barcode: 'X', modelCode: 'Y' }),
        makeRow({ id: 'barcode', productTitle: 'X', barcode: 'ABC-999', modelCode: 'Y' }),
        makeRow({ id: 'model', productTitle: 'X', barcode: 'Z', modelCode: 'SKU-42' }),
        makeRow({ id: 'miss', productTitle: 'X', barcode: 'Z', modelCode: 'Q' }),
      ];
      expect(filterDiscountRows(rows, filters({ query: 'hoparlör' })).map((r) => r.id)).toEqual([
        'title',
      ]);
      expect(filterDiscountRows(rows, filters({ query: 'abc-999' })).map((r) => r.id)).toEqual([
        'barcode',
      ]);
      expect(filterDiscountRows(rows, filters({ query: 'sku-42' })).map((r) => r.id)).toEqual([
        'model',
      ]);
    });

    it('ignores null search fields without throwing', () => {
      const rows = [makeRow({ id: 'a', modelCode: null })];
      expect(filterDiscountRows(rows, filters({ query: 'model-1' }))).toEqual([]);
    });

    it('lowercases with the Turkish locale (dotless I): "KIRMIZI BAYRAK" matches "kırmızı"', () => {
      const rows = [
        makeRow({ id: 'tr', productTitle: 'KIRMIZI BAYRAK', barcode: 'X', modelCode: 'Y' }),
      ];
      expect(filterDiscountRows(rows, filters({ query: 'kırmızı' })).map((r) => r.id)).toEqual([
        'tr',
      ]);
    });
  });

  describe('combined filters', () => {
    it('applies every active predicate together (AND semantics)', () => {
      const rows = [
        // profitable + matches query → kept
        makeRow({
          id: 'keep',
          productTitle: 'Deri Cüzdan',
          discountedNetProfit: '8.00',
        }),
        // profitable but fails the query
        makeRow({
          id: 'wrong-query',
          productTitle: 'Başka Ürün',
          discountedNetProfit: '8.00',
        }),
        // matches query but not profitable
        makeRow({
          id: 'losing',
          productTitle: 'Deri Cüzdan',
          discountedNetProfit: '-1.00',
        }),
      ];
      const kept = filterDiscountRows(rows, filters({ query: 'cüzdan', profitable: true }));
      expect(kept.map((r) => r.id)).toEqual(['keep']);
    });
  });
});

// ─── profitableSelections ─────────────────────────────────────────────────────

describe('profitableSelections', () => {
  it('is EXCLUSIVE: profitable rows → true, loss/null rows → false (all visible rows present)', () => {
    const rows = [
      makeRow({ id: 'pos', discountedNetProfit: '2.00' }),
      makeRow({ id: 'zero', discountedNetProfit: '0' }),
      makeRow({ id: 'neg', discountedNetProfit: '-4.00' }),
      makeRow({ id: 'null', discountedNetProfit: null }),
    ];
    expect(profitableSelections(rows)).toEqual([
      { itemId: 'pos', included: true },
      { itemId: 'zero', included: false },
      { itemId: 'neg', included: false },
      { itemId: 'null', included: false },
    ]);
  });

  it('respects the caller-supplied (already filtered) row set — hidden rows are absent', () => {
    const allRows = [
      makeRow({ id: 'visible-pos', discountedNetProfit: '2.00' }),
      makeRow({ id: 'hidden-pos', discountedNetProfit: '2.00' }),
    ];
    // Caller passes only the first row (the visible slice); the second must not appear at all
    // (so mode 'set' leaves the hidden row's current selection untouched).
    expect(profitableSelections([allRows[0]])).toEqual([{ itemId: 'visible-pos', included: true }]);
  });

  it('returns an empty array for empty input', () => {
    expect(profitableSelections([])).toEqual([]);
  });
});
