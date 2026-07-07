import { describe, expect, it } from 'vitest';

import type {
  AdvantageBand,
  AdvantageTariffRow,
} from '@/features/campaigns/lib/adapt-advantage-tariff';
import { summarizeAdvantageSelection } from '@/features/campaigns/lib/advantage-tariff-summary';

/** The row's single star tier, carrying the tier-join net profit under key `tier1`. */
function tier(netProfit: string | null): AdvantageBand {
  return { key: 'tier1', price: '500', commissionPct: '13', netProfit, marginPct: '10' };
}

function makeRow(
  id: string,
  currentNetProfit: string | null,
  tierNetProfit: string | null,
): AdvantageTariffRow {
  return {
    id,
    barcode: id,
    stockCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    size: null,
    stock: null,
    currentPrice: '100',
    customerPrice: '100',
    hasCommissionTariff: true,
    currentCommissionPct: '10',
    currentNetProfit,
    currentMarginPct: '5',
    calculable: true,
    reason: null,
    selectedTier: null,
    customPrice: null,
    bands: [tier(tierNetProfit)],
    commissionBands: null,
  };
}

// a: current 5, tier 30. b: current 8, tier 12.
const rows: AdvantageTariffRow[] = [makeRow('a', '5', '30'), makeRow('b', '8', '12')];

describe('summarizeAdvantageSelection', () => {
  it('sums the current baseline and reports zero joined when nothing is opted in', () => {
    const summary = summarizeAdvantageSelection(rows, {}, {});
    expect(summary.total).toBe(2);
    expect(summary.joinedCount).toBe(0);
    expect(summary.joinedProfit.toString()).toBe('0');
    // currentProfit = every row's current net profit: 5 + 8.
    expect(summary.currentProfit.toString()).toBe('13');
  });

  it('sums the joined tier profits, keeping the current baseline independent', () => {
    const summary = summarizeAdvantageSelection(rows, { a: 'tier1', b: 'tier1' }, {});
    expect(summary.joinedCount).toBe(2);
    // a.tier (30) + b.tier (12).
    expect(summary.joinedProfit.toString()).toBe('42');
    expect(summary.currentProfit.toString()).toBe('13');
  });

  it('totals a custom price with its captured profit instead of the tier', () => {
    // a is custom-joined at 450 whose captured estimate is 25 → total 25, not the tier's 30.
    const summary = summarizeAdvantageSelection(
      rows,
      {},
      { a: { price: '450', netProfit: '25', marginPct: '18' } },
    );
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('25');
  });

  it('ignores a null tier choice', () => {
    const summary = summarizeAdvantageSelection(rows, { a: null, b: 'tier1' }, {});
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('12');
  });

  it('treats an uncalculable profit as zero in both totals', () => {
    const withNull: AdvantageTariffRow[] = [makeRow('a', null, null), makeRow('b', '8', '12')];
    const summary = summarizeAdvantageSelection(withNull, { a: 'tier1', b: 'tier1' }, {});
    expect(summary.joinedCount).toBe(2);
    // a's tier profit is null → 0; b's tier is 12.
    expect(summary.joinedProfit.toString()).toBe('12');
    // a's current is null → 0; b's current is 8.
    expect(summary.currentProfit.toString()).toBe('8');
  });

  it('counts a seeded custom price with an unknown (null) profit as joined but zero-valued', () => {
    // The detail-client re-seeds a saved custom price with `netProfit: null` (the exact
    // profit for an arbitrary custom price is not in the payload). Lock that seeding
    // contract: the product still counts as joined, but contributes ZERO to the estimated
    // total until the live estimate re-confirms it.
    const summary = summarizeAdvantageSelection(
      rows,
      {},
      { a: { price: '150', netProfit: null, marginPct: null } },
    );
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('0');
  });
});
