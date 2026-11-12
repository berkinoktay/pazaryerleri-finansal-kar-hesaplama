import { planWindowFiles } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import type { PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import type {
  CustomChoice,
  CustomPriceMap,
  SelectionMap,
} from '@/features/campaigns/lib/bulk-actions';
import type {
  PlusCustomChoice,
  PlusCustomPriceMap,
  PlusSelectionMap,
} from '@/features/campaigns/lib/plus-bulk-actions';
import {
  computeExportPreview,
  resolveCommissionExportPrice,
  resolvePlusExportPrice,
} from '@/features/campaigns/lib/export-preview';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

// Every price below is a server `toFixed(2)` string: the resolvers only pick them.
const BAND_PRICES = {
  band1: '140.00',
  band2: '120.00',
  band3: '15.00',
  band4: '10.00',
} as const;

function band(key: keyof typeof BAND_PRICES): PriceBand {
  return {
    key,
    lowerLimit: null,
    upperLimit: null,
    price: BAND_PRICES[key],
    commissionPct: '10',
    netProfit: '5',
    marginPct: '5',
  };
}

function commissionRow(
  id: string,
  barcode: string,
  bands: readonly PriceBand[] = [band('band1'), band('band2'), band('band3'), band('band4')],
): CommissionTariffRow {
  return {
    id,
    barcode,
    stockCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    currentPrice: '150.00',
    commissionBasePrice: '150.00',
    currentCommissionPct: '10',
    currentNetProfit: '5',
    currentMarginPct: '5',
    calculable: true,
    reason: null,
    bestBandKey: null,
    selectedBand: null,
    customPrice: null,
    bands: [...bands],
  };
}

function plusRow(id: string, barcode: string, ceiling: string): PlusTariffRow {
  return {
    id,
    barcode,
    stockCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    currentPrice: '150.00',
    commissionBasePrice: '150.00',
    currentCommissionPct: '10',
    currentNetProfit: '5',
    currentMarginPct: '5',
    plusIsBetter: false,
    calculable: true,
    reason: null,
    selected: false,
    customPrice: null,
    bands: [{ key: 'plus', price: ceiling, commissionPct: '8', netProfit: '6', marginPct: '6' }],
  };
}

function custom(price: string): CustomChoice {
  return { price, netProfit: null, marginPct: null };
}

function plusCustom(price: string): PlusCustomChoice {
  return { price, netProfit: null, marginPct: null };
}

function commissionPreview(
  periods: readonly { dayCount: number | null; rows: readonly CommissionTariffRow[] }[],
  selection: SelectionMap,
  customPrices: CustomPriceMap = {},
): ReturnType<typeof computeExportPreview> {
  return computeExportPreview(periods, (row) =>
    resolveCommissionExportPrice(row, selection, customPrices),
  );
}

function plusPreview(
  periods: readonly { dayCount: number | null; rows: readonly PlusTariffRow[] }[],
  selection: PlusSelectionMap,
  customPrices: PlusCustomPriceMap = {},
): ReturnType<typeof computeExportPreview> {
  return computeExportPreview(periods, (row) =>
    resolvePlusExportPrice(row, selection, customPrices),
  );
}

// Split week: product X is item p3x in the 3-day period and p4x in the 4-day period;
// product Y likewise (p3y / p4y).
const SPLIT_WEEK = [
  { dayCount: 3, rows: [commissionRow('p3x', 'X'), commissionRow('p3y', 'Y')] },
  { dayCount: 4, rows: [commissionRow('p4x', 'X'), commissionRow('p4y', 'Y')] },
];

describe('resolveCommissionExportPrice', () => {
  const row = commissionRow('a', 'A');

  it('picks the selected band price', () => {
    expect(resolveCommissionExportPrice(row, { a: 'band2' }, {})).toBe('120.00');
  });

  it('lets a custom price win over the band price', () => {
    expect(resolveCommissionExportPrice(row, { a: 'band2' }, { a: custom('130.00') })).toBe(
      '130.00',
    );
  });

  it('falls back to the current price when the row lacks the selected band', () => {
    const narrow = commissionRow('a', 'A', [band('band1')]);
    expect(resolveCommissionExportPrice(narrow, { a: 'band3' }, {})).toBe('150.00');
  });

  it('is null for an unselected row', () => {
    expect(resolveCommissionExportPrice(row, {}, {})).toBeNull();
  });

  it('treats a non-band selection key as unselected, even with a custom price', () => {
    // Mirrors the save payload, which sends band null for a key outside the four bands.
    expect(resolveCommissionExportPrice(row, { a: 'plus' }, { a: custom('130.00') })).toBeNull();
  });
});

describe('resolvePlusExportPrice', () => {
  const row = plusRow('a', 'A', '99.90');

  it('picks the ceiling for a ceiling-joined row', () => {
    expect(resolvePlusExportPrice(row, { a: 'plus' }, {})).toBe('99.90');
  });

  it('picks the custom price for a custom-joined row', () => {
    expect(resolvePlusExportPrice(row, {}, { a: plusCustom('89.90') })).toBe('89.90');
  });

  it('is null for a row that is not joined', () => {
    expect(resolvePlusExportPrice(row, {}, {})).toBeNull();
  });
});

describe('computeExportPreview', () => {
  it('returns no files when nothing is selected', () => {
    expect(commissionPreview(SPLIT_WEEK, {})).toEqual([]);
  });

  it('a non-band selection key previews as unselected', () => {
    expect(commissionPreview(SPLIT_WEEK, { p3x: 'plus', p4x: 'band9' })).toEqual([]);
  });

  it('a single-period tariff gives one file at its day count', () => {
    const files = commissionPreview([{ dayCount: 7, rows: [commissionRow('a', 'A')] }], {
      a: 'band1',
    });
    expect(files).toEqual([{ dayCount: 7, count: 1 }]);
  });

  it('a same-price product goes to the whole-week file', () => {
    expect(commissionPreview(SPLIT_WEEK, { p3x: 'band2', p4x: 'band2' })).toEqual([
      { dayCount: 7, count: 1 },
    ]);
  });

  it('a product priced differently per period goes to each period file', () => {
    expect(commissionPreview(SPLIT_WEEK, { p3x: 'band2', p4x: 'band3' })).toEqual([
      { dayCount: 3, count: 1 },
      { dayCount: 4, count: 1 },
    ]);
  });

  it('a product selected in only one period goes to that period file', () => {
    expect(commissionPreview(SPLIT_WEEK, { p3x: 'band2' })).toEqual([{ dayCount: 3, count: 1 }]);
  });

  it('orders the period files before the whole-week file', () => {
    // X whole-week (band2 in both); Y split (band2 in the 3-day, band3 in the 4-day period).
    expect(
      commissionPreview(SPLIT_WEEK, { p3x: 'band2', p4x: 'band2', p3y: 'band2', p4y: 'band3' }),
    ).toEqual([
      { dayCount: 3, count: 1 },
      { dayCount: 4, count: 1 },
      { dayCount: 7, count: 1 },
    ]);
  });

  it('D1: a band price equal to a custom price in the other period is one whole-week product', () => {
    const files = commissionPreview(
      SPLIT_WEEK,
      { p3x: 'band2', p4x: 'band3' },
      { p4x: custom('120.00') },
    );
    expect(files).toEqual([{ dayCount: 7, count: 1 }]);
  });

  it('D2: a Plus ceiling equal to a custom price in the other period is one whole-week product', () => {
    const periods = [
      { dayCount: 3, rows: [plusRow('p3x', 'X', '99.90')] },
      { dayCount: 4, rows: [plusRow('p4x', 'X', '99.90')] },
    ];
    expect(plusPreview(periods, { p3x: 'plus' }, { p4x: plusCustom('99.90') })).toEqual([
      { dayCount: 7, count: 1 },
    ]);
  });

  it('D5: a barcode repeated in a single period counts once', () => {
    const periods = [{ dayCount: 7, rows: [commissionRow('a1', 'A'), commissionRow('a2', 'A')] }];
    expect(commissionPreview(periods, { a1: 'band1', a2: 'band2' })).toEqual([
      { dayCount: 7, count: 1 },
    ]);
  });

  it('D6: duplicates in a split week count the distinct keys of planWindowFiles', () => {
    // Each period repeats barcode X; the last row wins the period's pick, as in the export.
    const periods = [
      { dayCount: 3, rows: [commissionRow('x3a', 'X'), commissionRow('x3b', 'X')] },
      { dayCount: 4, rows: [commissionRow('x4a', 'X'), commissionRow('x4b', 'X')] },
    ];
    const files = commissionPreview(periods, {
      x3a: 'band2',
      x3b: 'band3',
      x4a: 'band1',
      x4b: 'band3',
    });
    const expected = planWindowFiles([
      { dayCount: 3, picks: new Map([['X', BAND_PRICES.band3]]) },
      { dayCount: 4, picks: new Map([['X', BAND_PRICES.band3]]) },
    ]).map((file) => ({ dayCount: file.dayCount, count: file.picks.size }));
    expect(files).toEqual(expected);
    expect(files).toEqual([{ dayCount: 7, count: 1 }]);
  });
});
