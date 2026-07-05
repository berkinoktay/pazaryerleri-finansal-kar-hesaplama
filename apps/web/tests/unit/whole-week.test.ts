import { describe, expect, it } from 'vitest';

import {
  buildWholeWeekIndex,
  choiceSignature,
  computeExportPreview,
  isWholeWeek,
} from '@/features/campaigns/lib/whole-week';

// A split week: product X is item p3x in the 3-Gün period and p4x in the 4-Gün period;
// product Y likewise (p3y / p4y). The index links a product's two item ids by barcode.
const PERIODS = [
  {
    rows: [
      { id: 'p3x', barcode: 'X' },
      { id: 'p3y', barcode: 'Y' },
    ],
  },
  {
    rows: [
      { id: 'p4x', barcode: 'X' },
      { id: 'p4y', barcode: 'Y' },
    ],
  },
];

describe('buildWholeWeekIndex', () => {
  it('links every item id of a product across periods by barcode', () => {
    const index = buildWholeWeekIndex(PERIODS);
    expect([...(index.rowIdsByBarcode.get('X') ?? [])].sort()).toEqual(['p3x', 'p4x']);
    expect([...(index.rowIdsByBarcode.get('Y') ?? [])].sort()).toEqual(['p3y', 'p4y']);
  });

  it('maps each item id back to its barcode', () => {
    const index = buildWholeWeekIndex(PERIODS);
    expect(index.barcodeByRowId.get('p3x')).toBe('X');
    expect(index.barcodeByRowId.get('p4y')).toBe('Y');
    expect(index.barcodeByRowId.get('ghost')).toBeUndefined();
  });
});

describe('choiceSignature', () => {
  it('folds a band selection to its key', () => {
    expect(choiceSignature('p3x', { p3x: 'band2' }, {})).toBe('band2');
  });

  it('lets a custom price win over the derived band', () => {
    const custom = { p3x: { price: '150.00', netProfit: null, marginPct: null } };
    expect(choiceSignature('p3x', { p3x: 'band2' }, custom)).toBe('custom:150.00');
  });

  it('is null for an unselected row', () => {
    expect(choiceSignature('p3x', {}, {})).toBeNull();
  });
});

describe('isWholeWeek', () => {
  it('is true when every period shares the same band', () => {
    const ids = ['p3x', 'p4x'];
    expect(isWholeWeek(ids, { p3x: 'band2', p4x: 'band2' }, {})).toBe(true);
  });

  it('is true when every period shares the same custom price (different commissions ok)', () => {
    const ids = ['p3x', 'p4x'];
    const custom = {
      p3x: { price: '150.00', netProfit: '10', marginPct: '5' },
      p4x: { price: '150.00', netProfit: '8', marginPct: '4' },
    };
    expect(isWholeWeek(ids, { p3x: 'band2', p4x: 'band2' }, custom)).toBe(true);
  });

  it('is false when the periods differ', () => {
    expect(isWholeWeek(['p3x', 'p4x'], { p3x: 'band2', p4x: 'band3' }, {})).toBe(false);
  });

  it('is false when one period is unselected', () => {
    expect(isWholeWeek(['p3x', 'p4x'], { p3x: 'band2' }, {})).toBe(false);
  });

  it('is false for a single-period product (nothing to spread)', () => {
    expect(isWholeWeek(['p3x'], { p3x: 'band2' }, {})).toBe(false);
  });
});

// Split week: product X (p3x/p4x) and Y (p3y/p4y), the 3-Gün + 4-Gün sub-periods.
const PREVIEW_PERIODS = [
  {
    dayCount: 3,
    rows: [
      { id: 'p3x', barcode: 'X' },
      { id: 'p3y', barcode: 'Y' },
    ],
  },
  {
    dayCount: 4,
    rows: [
      { id: 'p4x', barcode: 'X' },
      { id: 'p4y', barcode: 'Y' },
    ],
  },
];

describe('computeExportPreview', () => {
  it('returns no files when nothing is selected', () => {
    expect(computeExportPreview(PREVIEW_PERIODS, {}, {})).toEqual([]);
  });

  it('a same-price product → one 7-günlük file', () => {
    const files = computeExportPreview(PREVIEW_PERIODS, { p3x: 'band2', p4x: 'band2' }, {});
    expect(files).toEqual([{ dayCount: 7, count: 1 }]);
  });

  it('a 3-Gün ≠ 4-Gün product → a 3-gün and a 4-gün file', () => {
    const files = computeExportPreview(PREVIEW_PERIODS, { p3x: 'band2', p4x: 'band3' }, {});
    expect(files).toEqual([
      { dayCount: 3, count: 1 },
      { dayCount: 4, count: 1 },
    ]);
  });

  it('a product selected only in the 3-Gün period → just a 3-gün file', () => {
    expect(computeExportPreview(PREVIEW_PERIODS, { p3x: 'band2' }, {})).toEqual([
      { dayCount: 3, count: 1 },
    ]);
  });

  it('buckets a whole-week product and a split product across all three files', () => {
    // X whole-week (band2 both); Y split (band2 in 3-gün, band3 in 4-gün).
    const files = computeExportPreview(
      PREVIEW_PERIODS,
      { p3x: 'band2', p4x: 'band2', p3y: 'band2', p4y: 'band3' },
      {},
    );
    expect(files).toEqual([
      { dayCount: 3, count: 1 }, // Y's 3-gün price
      { dayCount: 4, count: 1 }, // Y's 4-gün price
      { dayCount: 7, count: 1 }, // X whole-week
    ]);
  });

  it('a single-period (full-week) tariff → one file at its day count', () => {
    const files = computeExportPreview(
      [{ dayCount: 7, rows: [{ id: 'a', barcode: 'A' }] }],
      { a: 'band1' },
      {},
    );
    expect(files).toEqual([{ dayCount: 7, count: 1 }]);
  });
});
