import { describe, expect, it } from 'vitest';

import type { PlusBand, PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import { summarizePlusSelection } from '@/features/campaigns/lib/plus-tariff-summary';

/** The row's single Plus offer, carrying the ceiling-join net profit. */
function offer(netProfit: string | null): PlusBand {
  return { key: 'plus', price: '500', commissionPct: '13', netProfit, marginPct: '10' };
}

function makeRow(
  id: string,
  currentNetProfit: string | null,
  offerNetProfit: string | null,
): PlusTariffRow {
  return {
    id,
    barcode: id,
    stockCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    currentPrice: '100',
    commissionBasePrice: '100',
    currentCommissionPct: '10',
    currentNetProfit,
    currentMarginPct: '5',
    plusIsBetter: false,
    calculable: true,
    reason: null,
    selected: false,
    customPrice: null,
    bands: [offer(offerNetProfit)],
  };
}

// a: current 5, offer 30. b: current 8, offer 12.
const rows: PlusTariffRow[] = [makeRow('a', '5', '30'), makeRow('b', '8', '12')];

describe('summarizePlusSelection', () => {
  it('sums the current baseline and reports zero joined when nothing is opted in', () => {
    const summary = summarizePlusSelection(rows, {}, {});
    expect(summary.total).toBe(2);
    expect(summary.joinedCount).toBe(0);
    expect(summary.joinedProfit.toString()).toBe('0');
    // currentProfit = every row's current net profit: 5 + 8.
    expect(summary.currentProfit.toString()).toBe('13');
  });

  it('sums the joined offers at the ceiling, keeping the current baseline independent', () => {
    const summary = summarizePlusSelection(rows, { a: 'plus', b: 'plus' }, {});
    expect(summary.joinedCount).toBe(2);
    // a.offer (30) + b.offer (12).
    expect(summary.joinedProfit.toString()).toBe('42');
    expect(summary.currentProfit.toString()).toBe('13');
  });

  it('totals a custom price with its captured profit instead of the offer', () => {
    // a is custom-joined at 450 whose captured estimate is 25 → total 25, not the offer's 30.
    const summary = summarizePlusSelection(
      rows,
      {},
      { a: { price: '450', netProfit: '25', marginPct: '18' } },
    );
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('25');
  });

  it('ignores a null ceiling choice', () => {
    const summary = summarizePlusSelection(rows, { a: null, b: 'plus' }, {});
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('12');
  });

  it('treats an uncalculable profit as zero in both totals', () => {
    const withNull: PlusTariffRow[] = [makeRow('a', null, null), makeRow('b', '8', '12')];
    const summary = summarizePlusSelection(withNull, { a: 'plus', b: 'plus' }, {});
    expect(summary.joinedCount).toBe(2);
    // a's offer profit is null → 0; b's offer is 12.
    expect(summary.joinedProfit.toString()).toBe('12');
    // a's current is null → 0; b's current is 8.
    expect(summary.currentProfit.toString()).toBe('8');
  });
});
