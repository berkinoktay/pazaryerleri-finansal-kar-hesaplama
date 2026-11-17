import { describe, expect, it } from 'vitest';

import type { PlusBand, PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import { seedPlusSelection } from '@/features/campaigns/lib/seed-plus-selection';

// Every money value below is a two-decimal server string: the seed only picks them.
// An offer with no price (unknown ceiling) carries no profit, as the backend sends it.
function offer(price: string | null): PlusBand {
  return {
    key: 'plus',
    price,
    commissionPct: '8',
    netProfit: price === null ? null : '6.00',
    marginPct: price === null ? null : '4.00',
  };
}

function row(
  id: string,
  overrides: Partial<Pick<PlusTariffRow, 'selected' | 'customPrice' | 'bands'>> = {},
): PlusTariffRow {
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
    plusIsBetter: false,
    calculable: true,
    reason: null,
    selected: false,
    customPrice: null,
    bands: [offer('140.00')],
    ...overrides,
  };
}

function seed(...rows: PlusTariffRow[]): ReturnType<typeof seedPlusSelection> {
  return seedPlusSelection([{ rows }]);
}

describe('seedPlusSelection', () => {
  it('joins at the ceiling a stored join with a known ceiling', () => {
    expect(seed(row('a', { selected: true }))).toEqual({
      selection: { a: 'plus' },
      customPrices: {},
    });
  });

  it("restores a custom price with the offer's profit", () => {
    expect(seed(row('a', { selected: true, customPrice: '130.00' }))).toEqual({
      selection: {},
      customPrices: { a: { price: '130.00', netProfit: '6.00', marginPct: '4.00' } },
    });
  });

  it('keeps a custom-priced join when the ceiling is unknown', () => {
    expect(seed(row('a', { selected: true, customPrice: '130.00', bands: [offer(null)] }))).toEqual(
      {
        selection: {},
        customPrices: { a: { price: '130.00', netProfit: null, marginPct: null } },
      },
    );
  });

  it('drops a stored join with no custom price when the ceiling is unknown', () => {
    expect(seed(row('a', { selected: true, bands: [offer(null)] }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('drops a stored join when the offer commission is unknown', () => {
    // The ceiling is known, so only the unknown Plus commission drops the join.
    const noCommission: PlusBand = {
      ...offer('140.00'),
      commissionPct: null,
      netProfit: null,
      marginPct: null,
    };
    expect(seed(row('a', { selected: true, bands: [noCommission] }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('drops it also with a custom price', () => {
    // A custom price does not supply the commission: the route would still refuse it.
    const noCommission: PlusBand = {
      ...offer('140.00'),
      commissionPct: null,
      netProfit: null,
      marginPct: null,
    };
    expect(
      seed(row('a', { selected: true, customPrice: '130.00', bands: [noCommission] })),
    ).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('leaves an unjoined row out of both maps', () => {
    expect(seed(row('a'), row('b', { bands: [offer(null)] }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('leaves unjoined a custom price stored on a row that is not joined', () => {
    // The route accepts { selected: false, customPrice }; restoring it as a custom join
    // would make the next save join Plus without the seller asking.
    expect(seed(row('a', { selected: false, customPrice: '130.00' }))).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('seeds the rows of every period', () => {
    const state = seedPlusSelection([
      { rows: [row('a', { selected: true })] },
      { rows: [row('b', { selected: true, customPrice: '120.00' })] },
    ]);
    expect(state.selection).toEqual({ a: 'plus' });
    expect(state.customPrices).toEqual({
      b: { price: '120.00', netProfit: '6.00', marginPct: '4.00' },
    });
  });
});
