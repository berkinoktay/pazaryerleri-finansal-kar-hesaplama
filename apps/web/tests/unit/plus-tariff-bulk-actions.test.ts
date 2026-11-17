import { describe, expect, it } from 'vitest';

import type { PlusBand, PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import {
  clearJoins,
  filterPlusRows,
  isJoinedRow,
  joinProfitable,
  plusOffer,
  selectBestForAll,
  type PlusSelectionState,
  type PlusTariffFilterState,
} from '@/features/campaigns/lib/plus-bulk-actions';

/** An empty choice state — nothing joined, no custom prices. */
function emptyState(): PlusSelectionState {
  return { selection: {}, customPrices: {} };
}

/** The row's single Plus offer (`bands.length === 1`). */
function offer(
  netProfit: string | null,
  marginPct: string | null,
  price: string | null = '500',
): PlusBand {
  return { key: 'plus', price, commissionPct: '13', netProfit, marginPct };
}

function row(id: string, overrides: Partial<PlusTariffRow> = {}): PlusTariffRow {
  return {
    id,
    barcode: id,
    stockCode: id,
    productTitle: id,
    imageUrl: null,
    category: 'Cat',
    brand: 'Brand',
    currentPrice: '100',
    commissionBasePrice: '100',
    currentCommissionPct: '10',
    currentNetProfit: '5',
    currentMarginPct: '5',
    plusIsBetter: false,
    calculable: true,
    reason: null,
    selected: false,
    customPrice: null,
    bands: [offer('30', '20')],
    ...overrides,
  };
}

// winner: Plus beats doing nothing. loser: Plus loses. uncalc: no calculable figures.
const winner = row('r1', { plusIsBetter: true, bands: [offer('30', '20')] });
const loser = row('r2', { plusIsBetter: false, bands: [offer('-5', '-3')] });
const uncalc = row('r3', { plusIsBetter: false, calculable: false, bands: [offer(null, null)] });

describe('plus bulk-actions', () => {
  it('selectBestForAll joins the profitable rows at the ceiling and un-joins the rest', () => {
    const next = selectBestForAll([winner, loser, uncalc], emptyState());
    // winner → 'plus', loser → null; the uncalculable row is left untouched (can't join).
    expect(next.selection).toEqual({ r1: 'plus', r2: null });
    expect(next.selection.r3).toBeUndefined();
    // Both touched rows also drop any custom price (the two maps stay exclusive).
    expect(next.customPrices).toEqual({ r1: null, r2: null });
  });

  it('selectBestForAll clears a custom price it overwrites', () => {
    const state: PlusSelectionState = {
      selection: { r1: 'plus' },
      customPrices: { r1: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = selectBestForAll([winner], state);
    expect(next.selection.r1).toBe('plus');
    expect(next.customPrices.r1).toBeNull();
  });

  it('selectBestForAll joins a profitable offer when the current profit is unknown', () => {
    const unknownCurrent = row('r6', {
      currentNetProfit: null,
      currentMarginPct: null,
      plusIsBetter: false,
      bands: [offer('12', '8')],
    });
    const state: PlusSelectionState = {
      selection: {},
      customPrices: { r6: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = selectBestForAll([unknownCurrent], state);
    expect(next.selection.r6).toBe('plus');
    expect(next.customPrices.r6).toBeNull();
  });

  it('selectBestForAll leaves a row untouched when the current profit is unknown and the offer loses', () => {
    const losing = row('r7', {
      currentNetProfit: null,
      currentMarginPct: null,
      bands: [offer('-4', '-2')],
    });
    const breakEven = row('r8', {
      currentNetProfit: null,
      currentMarginPct: null,
      bands: [offer('0', '0')],
    });
    const state: PlusSelectionState = {
      selection: { r7: 'plus' },
      customPrices: { r8: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = selectBestForAll([losing, breakEven], state);
    // Neither row is overwritten: the existing join and custom price survive as they were.
    expect(next.selection).toEqual({ r7: 'plus' });
    expect(next.customPrices).toEqual({
      r8: { price: '450', netProfit: '30', marginPct: '20' },
    });
  });

  it('selectBestForAll never joins an offer with no price', () => {
    // plusIsBetter is forced true so only the price guard keeps the row out.
    const noPrice = row('r9', { plusIsBetter: true, bands: [offer('30', '20', null)] });
    const noPriceUnknownCurrent = row('r10', {
      currentNetProfit: null,
      currentMarginPct: null,
      bands: [offer('30', '20', null)],
    });
    const state: PlusSelectionState = {
      selection: {},
      customPrices: { r9: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = selectBestForAll([noPrice, noPriceUnknownCurrent], state);
    expect(next.selection.r9).toBeUndefined();
    expect(next.selection.r10).toBeUndefined();
    // Untouched, so the custom-priced join on r9 survives.
    expect(next.customPrices.r9).toEqual({ price: '450', netProfit: '30', marginPct: '20' });
    expect(next.customPrices.r10).toBeUndefined();
  });

  it('joinProfitable never joins an offer with no price', () => {
    // plusIsBetter is forced true so only the price guard keeps the row out.
    const noPrice = row('r11', { plusIsBetter: true, bands: [offer('30', '20', null)] });
    const state: PlusSelectionState = {
      selection: {},
      customPrices: { r11: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = joinProfitable([noPrice], state);
    expect(next.selection.r11).toBeUndefined();
    expect(next.customPrices.r11).toEqual({ price: '450', netProfit: '30', marginPct: '20' });
  });

  it('joinProfitable joins only the winning rows, leaving the rest untouched', () => {
    const next = joinProfitable([winner, loser], emptyState());
    expect(next.selection.r1).toBe('plus');
    // The loser is not touched at all (absent, not set to null).
    expect(next.selection.r2).toBeUndefined();
  });

  it('joinProfitable switches a custom-priced winner to the ceiling', () => {
    const state: PlusSelectionState = {
      selection: {},
      customPrices: { r1: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = joinProfitable([winner], state);
    expect(next.selection.r1).toBe('plus');
    expect(next.customPrices.r1).toBeNull();
  });

  it('clearJoins un-joins both the ceiling and the custom price of the listed rows only', () => {
    const state: PlusSelectionState = {
      selection: { r1: 'plus', r2: 'plus' },
      customPrices: { r1: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = clearJoins([winner], state);
    expect(next.selection.r1).toBeNull();
    expect(next.customPrices.r1).toBeNull();
    // r2 was not in the listed rows → untouched.
    expect(next.selection.r2).toBe('plus');
  });

  it('isJoinedRow is true for a ceiling join OR a custom price, false otherwise', () => {
    expect(isJoinedRow({ r1: 'plus' }, {}, 'r1')).toBe(true);
    expect(isJoinedRow({}, { r1: { price: '450', netProfit: null, marginPct: null } }, 'r1')).toBe(
      true,
    );
    expect(isJoinedRow({}, {}, 'r1')).toBe(false);
    expect(isJoinedRow({ r1: null }, {}, 'r1')).toBe(false);
  });

  it('plusOffer returns the row single Plus offer', () => {
    expect(plusOffer(winner)?.key).toBe('plus');
    expect(plusOffer(winner)?.netProfit).toBe('30');
  });

  it('filterPlusRows filters by the offer profit sign', () => {
    const filters: PlusTariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'profitable',
      selection: 'all',
    };
    expect(filterPlusRows([winner, loser], {}, {}, filters).map((r) => r.id)).toEqual(['r1']);
  });

  it('filterPlusRows tolerates a null offer margin without crashing', () => {
    const nullRow = row('r5', { bands: [offer(null, null)], category: null, brand: null });
    const filters: PlusTariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: 10,
      profit: 'all',
      selection: 'all',
    };
    // minMarginPct=10 with a null offer margin → excluded, no throw.
    expect(filterPlusRows([nullRow], {}, {}, filters)).toHaveLength(0);
  });

  it('filterPlusRows filters by join state', () => {
    const filters: PlusTariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'all',
      selection: 'selected',
    };
    expect(filterPlusRows([winner, loser], { r1: 'plus' }, {}, filters).map((r) => r.id)).toEqual([
      'r1',
    ]);
  });
});
