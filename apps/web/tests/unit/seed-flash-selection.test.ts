import { describe, expect, it } from 'vitest';

import type {
  FlashBand,
  FlashOfferKey,
  FlashProductRow,
} from '@/features/campaigns/lib/adapt-flash-product';
import { seedFlashSelection } from '@/features/campaigns/lib/seed-flash-selection';

// Every money value below is a two-decimal server string: the seed only orders them.
function offer(key: FlashOfferKey, price: string): FlashBand {
  return {
    key,
    price,
    commissionPct: '13.10',
    netProfit: '20.00',
    marginPct: '10.00',
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
  };
}

/** A row with both offers: the 24-hour one at 600, the 3-hour one at 550 (the ceiling). */
function row(
  id: string,
  overrides: Partial<Pick<FlashProductRow, 'selectedOffer' | 'customPrice' | 'bands'>> = {},
): FlashProductRow {
  return {
    id,
    barcode: id,
    modelCode: id,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    stock: null,
    currentPrice: '800.00',
    customerPrice: '800.00',
    currentCommissionPct: '19.00',
    currentNetProfit: '5.00',
    currentMarginPct: '5.00',
    calculable: true,
    reason: null,
    hasCommissionTariff: true,
    commissionSource: 'band',
    commissionBands: null,
    selectedOffer: null,
    customPrice: null,
    bands: [offer('h24', '600.00'), offer('h3', '550.00')],
    flashDay: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

describe('seedFlashSelection', () => {
  it('keeps a stored offer the row carries', () => {
    expect(seedFlashSelection([row('a', { selectedOffer: 'H3' })])).toEqual({
      selection: { a: 'h3' },
      customPrices: {},
    });
  });

  it('keeps a stored custom price below the lowest offer price, without a profit', () => {
    expect(seedFlashSelection([row('a', { customPrice: '540.00' })])).toEqual({
      selection: {},
      customPrices: { a: { price: '540.00', netProfit: null, marginPct: null } },
    });
  });

  it('keeps a stored custom price equal to the lowest offer price', () => {
    // The route refuses only a price above the ceiling.
    expect(seedFlashSelection([row('a', { customPrice: '550.00' })]).customPrices).toEqual({
      a: { price: '550.00', netProfit: null, marginPct: null },
    });
  });

  it('drops a stored offer the row does not carry', () => {
    expect(
      seedFlashSelection([row('a', { selectedOffer: 'H3', bands: [offer('h24', '600.00')] })]),
    ).toEqual({ selection: {}, customPrices: {} });
  });

  it('drops a stored custom price above the lowest offer price', () => {
    // 560 is below the 24-hour offer but above the 3-hour one, which is the ceiling.
    expect(seedFlashSelection([row('a', { customPrice: '560.00' })])).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('drops a stored custom price on a row that carries no offer', () => {
    expect(seedFlashSelection([row('a', { customPrice: '100.00', bands: [] })])).toEqual({
      selection: {},
      customPrices: {},
    });
  });

  it('does not fall back to the stored offer when the custom price is dropped', () => {
    expect(seedFlashSelection([row('a', { selectedOffer: 'H24', customPrice: '700.00' })])).toEqual(
      { selection: {}, customPrices: {} },
    );
  });

  it('seeds nothing for a row without a stored choice', () => {
    expect(seedFlashSelection([row('a')])).toEqual({ selection: {}, customPrices: {} });
  });

  it('seeds every row on its own', () => {
    const state = seedFlashSelection([
      row('kept', { selectedOffer: 'H24' }),
      row('stale', { selectedOffer: 'H3', bands: [offer('h24', '600.00')] }),
      row('custom', { customPrice: '500.00' }),
    ]);
    expect(state.selection).toEqual({ kept: 'h24' });
    expect(Object.keys(state.customPrices)).toEqual(['custom']);
  });
});
