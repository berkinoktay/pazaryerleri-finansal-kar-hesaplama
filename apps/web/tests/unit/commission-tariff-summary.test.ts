import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { summarizeSelection } from '@/features/campaigns/lib/commission-tariff-summary';
import type { BandKey, CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

function makeBand(key: BandKey, profit: string): PriceBand {
  return {
    key,
    thresholdLabel: '',
    threshold: new Decimal('0'),
    commissionPct: new Decimal('0.1'),
    profit: new Decimal(profit),
    marginPct: '0',
  };
}

function makeRow(
  id: string,
  bestBand: BandKey,
  profits: [string, string, string, string],
): CommissionTariffRow {
  return {
    id,
    productTitle: id,
    category: '',
    brand: '',
    modelCode: '',
    barcode: '',
    stock: 0,
    currentPrice: new Decimal('100'),
    displayPrice: new Decimal('100'),
    currentCommissionPct: new Decimal('0.1'),
    unitCost: new Decimal('80'),
    bands: [
      makeBand('band1', profits[0]),
      makeBand('band2', profits[1]),
      makeBand('band3', profits[2]),
      makeBand('band4', profits[3]),
    ],
    bestBand,
  };
}

const rows: CommissionTariffRow[] = [
  makeRow('a', 'band2', ['10', '30', '20', '15']),
  makeRow('b', 'band1', ['40', '12', '8', '5']),
];

describe('summarizeSelection', () => {
  it('sums best-case profit and reports zero chosen when selection is empty', () => {
    const summary = summarizeSelection(rows, {});
    expect(summary.total).toBe(2);
    expect(summary.selectedCount).toBe(0);
    expect(summary.selectedProfit.toString()).toBe('0');
    // best bands: a.band2 (30) + b.band1 (40)
    expect(summary.bestProfit.toString()).toBe('70');
  });

  it('sums the chosen bands and keeps best-case independent of the choice', () => {
    const summary = summarizeSelection(rows, { a: 'band1', b: 'band3' });
    expect(summary.selectedCount).toBe(2);
    // a.band1 (10) + b.band3 (8)
    expect(summary.selectedProfit.toString()).toBe('18');
    expect(summary.bestProfit.toString()).toBe('70');
  });

  it('ignores null choices', () => {
    const summary = summarizeSelection(rows, { a: null, b: 'band2' });
    expect(summary.selectedCount).toBe(1);
    expect(summary.selectedProfit.toString()).toBe('12');
  });
});
