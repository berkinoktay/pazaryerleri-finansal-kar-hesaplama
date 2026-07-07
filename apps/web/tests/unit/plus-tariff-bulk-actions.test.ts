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
function offer(netProfit: string | null, marginPct: string | null, price = '500'): PlusBand {
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
