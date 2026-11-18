import { describe, expect, it } from 'vitest';

import type {
  AdvantageBand,
  AdvantageTariffRow,
  NonNullStarTierKey,
} from '@/features/campaigns/lib/adapt-advantage-tariff';
import { seedAdvantageSelection } from '@/features/campaigns/lib/seed-advantage-selection';

// Every money value below is a two-decimal server string: the seed only picks them.
function tier(key: NonNullStarTierKey, price: string): AdvantageBand {
  return { key, price, commissionPct: '13', netProfit: '20.00', marginPct: '10.00' };
}

/** A row storing the first two star tiers only. */
function row(
  id: string,
  overrides: Partial<Pick<AdvantageTariffRow, 'selectedTier' | 'customPrice' | 'bands'>> = {},
): AdvantageTariffRow {
  return {
    id,
    barcode: id,
    stockCode: id,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    size: null,
    stock: null,
    currentPrice: '100.00',
    customerPrice: '100.00',
    hasCommissionTariff: true,
    currentCommissionPct: '10',
    currentNetProfit: '5.00',
    currentMarginPct: '5.00',
    calculable: true,
    reason: null,
    selectedTier: null,
    customPrice: null,
    bands: [tier('tier1', '95.00'), tier('tier2', '90.00')],
    commissionBands: null,
    ...overrides,
  };
}

describe('seedAdvantageSelection', () => {
  it('keeps a stored tier the row stores', () => {
    expect(seedAdvantageSelection([row('a', { selectedTier: 'tier2' })])).toEqual({
      selection: { a: 'tier2' },
      customPrices: {},
    });
  });

  it('keeps a stored custom price, without a profit', () => {
    expect(seedAdvantageSelection([row('a', { customPrice: '92.50' })])).toEqual({
      selection: {},
      customPrices: { a: { price: '92.50', netProfit: null, marginPct: null } },
    });
  });

  it('drops a stored tier the row does not store', () => {
    expect(seedAdvantageSelection([row('a', { selectedTier: 'tier3' })])).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('drops a stored tier on a row that stores no tier', () => {
    expect(seedAdvantageSelection([row('a', { selectedTier: 'tier1', bands: [] })])).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('seeds nothing for a row without a stored choice', () => {
    expect(seedAdvantageSelection([row('a')])).toEqual({ selection: {}, customPrices: {} });
  });

  it('seeds every row on its own', () => {
    const state = seedAdvantageSelection([
      row('kept', { selectedTier: 'tier1' }),
      row('stale', { selectedTier: 'tier3' }),
      row('custom', { customPrice: '80.00' }),
    ]);
    expect(state.selection).toEqual({ kept: 'tier1' });
    expect(Object.keys(state.customPrices)).toEqual(['custom']);
  });
});
