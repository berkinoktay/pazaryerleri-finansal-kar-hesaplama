import { describe, expect, it } from 'vitest';

import { seedCommissionSelection } from '@/features/campaigns/lib/seed-commission-selection';
import type { BandKey, CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

// Every money value below is a two-decimal server string: the seed only picks them.
function band(
  key: BandKey,
  price: string | null,
  netProfit = '5.00',
  marginPct = '4.00',
): PriceBand {
  return {
    key,
    lowerLimit: null,
    upperLimit: null,
    price,
    commissionPct: '10',
    netProfit: price === null ? null : netProfit,
    marginPct: price === null ? null : marginPct,
  };
}

function row(
  id: string,
  overrides: Partial<Pick<CommissionTariffRow, 'selectedBand' | 'customPrice' | 'bands'>> = {},
): CommissionTariffRow {
  return {
    id,
    barcode: id,
    stockCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    currentPrice: '150.00',
    commissionBasePrice: '150.00',
    currentCommissionPct: '10',
    currentNetProfit: '5.00',
    currentMarginPct: '4.00',
    calculable: true,
    reason: null,
    bestBandKey: null,
    selectedBand: null,
    customPrice: null,
    bands: [band('band1', '140.00'), band('band2', '120.00')],
    ...overrides,
  };
}

function seed(...rows: CommissionTariffRow[]): ReturnType<typeof seedCommissionSelection> {
  return seedCommissionSelection([{ rows }]);
}

describe('seedCommissionSelection', () => {
  it('keeps a stored band the row holds', () => {
    expect(seed(row('a', { selectedBand: 'band2' }))).toEqual({
      selection: { a: 'band2' },
      customPrices: {},
    });
  });

  it('keeps a custom-priced selection on a band with no price', () => {
    const state = seed(
      row('a', { selectedBand: 'band1', customPrice: '130.00', bands: [band('band1', null)] }),
    );
    expect(state.selection).toEqual({ a: 'band1' });
    expect(state.customPrices).toEqual({
      a: { price: '130.00', netProfit: null, marginPct: null },
    });
  });

  it('drops a stored band the row does not hold', () => {
    expect(seed(row('a', { selectedBand: 'band3' }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('drops a custom-priced selection on a band the row does not hold', () => {
    // The route refuses a band the item does not store even with a custom price.
    expect(seed(row('a', { selectedBand: 'band3', customPrice: '130.00' }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('drops a stored band with no price and no custom price', () => {
    expect(seed(row('a', { selectedBand: 'band1', bands: [band('band1', null)] }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it("restores the custom price with the band's profit", () => {
    const state = seed(
      row('a', {
        selectedBand: 'band2',
        customPrice: '125.00',
        bands: [band('band1', '140.00'), band('band2', '120.00', '7.50', '6.00')],
      }),
    );
    expect(state.selection).toEqual({ a: 'band2' });
    expect(state.customPrices).toEqual({
      a: { price: '125.00', netProfit: '7.50', marginPct: '6.00' },
    });
  });

  it('seeds nothing for a row without a stored selection', () => {
    expect(seed(row('a'))).toEqual({ selection: {}, customPrices: {} });
  });

  it('seeds the rows of every period', () => {
    const state = seedCommissionSelection([
      { rows: [row('p3', { selectedBand: 'band1' })] },
      { rows: [row('p4', { selectedBand: 'band2', bands: [band('band2', null)] })] },
      { rows: [row('p7', { selectedBand: 'band2' })] },
    ]);
    expect(state.selection).toEqual({ p3: 'band1', p7: 'band2' });
  });
});
