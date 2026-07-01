import { describe, expect, it } from 'vitest';

import { summarizeSelection } from '@/features/campaigns/lib/commission-tariff-summary';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

function makeBand(key: string, netProfit: string): PriceBand {
  return {
    key,
    lowerLimit: null,
    upperLimit: null,
    price: '100',
    commissionPct: '10',
    netProfit,
    marginPct: '0',
  };
}

function makeRow(
  id: string,
  bestBandKey: string,
  profits: [string, string, string, string],
): CommissionTariffRow {
  return {
    id,
    barcode: id,
    stockCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    currentPrice: '100',
    currentCommissionPct: '10',
    calculable: true,
    reason: null,
    bestBandKey,
    selectedBand: null,
    customPrice: null,
    bands: [
      makeBand('band1', profits[0]),
      makeBand('band2', profits[1]),
      makeBand('band3', profits[2]),
      makeBand('band4', profits[3]),
    ],
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
