import { describe, expect, it } from 'vitest';

import type {
  FlashBand,
  FlashOfferKey,
  FlashProductRow,
} from '@/features/campaigns/lib/adapt-flash-product';
import {
  bandForKey,
  clearSelections,
  filterFlashRows,
  isJoinedRow,
  selectBestForAll,
  selectProfitable,
  type FlashProductFilterState,
  type FlashSelectionState,
} from '@/features/campaigns/lib/flash-bulk-actions';

/** An empty choice state — nothing joined, no custom prices. */
function emptyState(): FlashSelectionState {
  return { selection: {}, customPrices: {} };
}

/** One flash offer as a band-like option (window fields fixed — irrelevant to selection). */
function offer(
  key: FlashOfferKey,
  netProfit: string | null,
  marginPct: string | null,
  price = '600.00',
): FlashBand {
  return {
    key,
    price,
    commissionPct: '13.10',
    netProfit,
    marginPct,
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
  };
}

/**
 * The default two-offer row: current profit is LOW (5) and the 24 Saatlik offer (30) is the
 * most profitable — so the holistic winner is the h24 offer, proving the resolver isn't just
 * defaulting to the current price.
 */
function row(id: string, overrides: Partial<FlashProductRow> = {}): FlashProductRow {
  return {
    id,
    barcode: id,
    modelCode: id,
    productTitle: id,
    imageUrl: null,
    category: 'Cat',
    brand: 'Brand',
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
    bands: [offer('h24', '30.00', '20.00'), offer('h3', '20.00', '15.00', '650.00')],
    ...overrides,
  };
}

// winner: an offer (h24, 30) beats doing nothing. currentWins: the current price (50) beats
// every offer. uncalc: no calculable figures at all.
const winner = row('r1');
const currentWins = row('r2', {
  currentNetProfit: '50.00',
  bands: [offer('h24', '10.00', '8.00'), offer('h3', '8.00', '6.00', '650.00')],
});
const uncalc = row('r3', {
  calculable: false,
  currentNetProfit: null,
  currentMarginPct: null,
  bands: [offer('h24', null, null), offer('h3', null, null, '650.00')],
});

describe('flash bulk-actions', () => {
  it('selectBestForAll selects the winning offer, leaves current-wins rows unselected, skips uncalculable', () => {
    const next = selectBestForAll([winner, currentWins, uncalc], emptyState());
    // winner → its best offer (h24), currentWins → null (keeping current wins). The
    // uncalculable row is left untouched (can't join).
    expect(next.selection).toEqual({ r1: 'h24', r2: null });
    expect(next.selection.r3).toBeUndefined();
    // Both touched rows also drop any custom price (the two maps stay exclusive).
    expect(next.customPrices).toEqual({ r1: null, r2: null });
  });

  it('selectBestForAll clears a custom price the winning offer overwrites', () => {
    // A committed custom (30) ties the winning offer's profit (30) — a tie does NOT let the
    // custom win, so the offer takes the row and the custom is cleared.
    const state: FlashSelectionState = {
      selection: { r1: 'h3' },
      customPrices: { r1: { price: '450.00', netProfit: '30.00', marginPct: '20.00' } },
    };
    const next = selectBestForAll([winner], state);
    expect(next.selection.r1).toBe('h24');
    expect(next.customPrices.r1).toBeNull();
  });

  it('selectBestForAll preserves a committed custom price that wins the row', () => {
    // The custom estimate (100) strictly beats every offer (≤30) and the current price (5),
    // so the custom commitment is kept and the offer selection is cleared.
    const custom = { price: '400.00', netProfit: '100.00', marginPct: '50.00' };
    const state: FlashSelectionState = {
      selection: { r1: 'h24' },
      customPrices: { r1: custom },
    };
    const next = selectBestForAll([winner], state);
    expect(next.selection.r1).toBeNull();
    expect(next.customPrices.r1).toEqual(custom);
  });

  it('selectProfitable selects only rows where an offer wins, leaving the rest untouched', () => {
    const next = selectProfitable([winner, currentWins], emptyState());
    expect(next.selection.r1).toBe('h24');
    // currentWins keeps its current price → not touched at all (absent, not set to null).
    expect(next.selection.r2).toBeUndefined();
  });

  it('selectProfitable switches a low custom-priced winner to the winning offer', () => {
    // The committed custom (5) loses to the offer (30) → the offer takes the row, custom cleared.
    const state: FlashSelectionState = {
      selection: {},
      customPrices: { r1: { price: '450.00', netProfit: '5.00', marginPct: '3.00' } },
    };
    const next = selectProfitable([winner], state);
    expect(next.selection.r1).toBe('h24');
    expect(next.customPrices.r1).toBeNull();
  });

  it('selectProfitable preserves a committed custom price that beats every offer', () => {
    // A custom (100) that wins the holistic race is not an offer win → the row is untouched.
    const custom = { price: '400.00', netProfit: '100.00', marginPct: '50.00' };
    const next = selectProfitable([winner], { selection: {}, customPrices: { r1: custom } });
    expect(next.selection.r1).toBeUndefined();
    expect(next.customPrices.r1).toEqual(custom);
  });

  it('clearSelections clears both the offer and the custom price of the listed rows only', () => {
    const state: FlashSelectionState = {
      selection: { r1: 'h24', r2: 'h3' },
      customPrices: { r1: { price: '450.00', netProfit: '30.00', marginPct: '20.00' } },
    };
    const next = clearSelections([winner], state);
    expect(next.selection.r1).toBeNull();
    expect(next.customPrices.r1).toBeNull();
    // r2 was not in the listed rows → untouched.
    expect(next.selection.r2).toBe('h3');
  });

  it('bandForKey returns the offer for a key and undefined when that offer is absent', () => {
    expect(bandForKey(winner, 'h24')?.netProfit).toBe('30.00');
    const only24 = row('r9', { bands: [offer('h24', '10.00', '8.00')] });
    expect(bandForKey(only24, 'h3')).toBeUndefined();
  });

  it('isJoinedRow is true for an offer OR a custom price, false otherwise', () => {
    expect(isJoinedRow({ r1: 'h24' }, {}, 'r1')).toBe(true);
    expect(isJoinedRow({}, { r1: { price: '1', netProfit: null, marginPct: null } }, 'r1')).toBe(
      true,
    );
    expect(isJoinedRow({}, {}, 'r1')).toBe(false);
    expect(isJoinedRow({ r1: null }, {}, 'r1')).toBe(false);
  });

  it('filterFlashRows filters by the best-offer profit sign', () => {
    const filters: FlashProductFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'profitable',
      selection: 'all',
    };
    const lossRow = row('rl', {
      bands: [offer('h24', '-5.00', '-3.00'), offer('h3', '-2.00', '-1.00', '650.00')],
    });
    expect(filterFlashRows([winner, lossRow], {}, {}, filters).map((r) => r.id)).toEqual(['r1']);
  });

  it('filterFlashRows tolerates a null best-offer margin without crashing', () => {
    const nullRow = row('r5', {
      calculable: false,
      currentNetProfit: null,
      bands: [offer('h24', null, null)],
      category: null,
      brand: null,
    });
    const filters: FlashProductFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: 10,
      profit: 'all',
      selection: 'all',
    };
    // minMarginPct=10 with a null best-offer margin → excluded, no throw.
    expect(filterFlashRows([nullRow], {}, {}, filters)).toHaveLength(0);
  });

  it('filterFlashRows matches the query against title, model code, and barcode', () => {
    const filters: FlashProductFilterState = {
      query: 'model',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'all',
      selection: 'all',
    };
    const named = row('r7', { productTitle: 'Kırmızı Ayakkabı', modelCode: 'MODEL-XYZ' });
    const other = row('r8', { productTitle: 'Mavi Çanta', modelCode: 'ABC-1', barcode: '999' });
    expect(filterFlashRows([named, other], {}, {}, filters).map((r) => r.id)).toEqual(['r7']);
  });

  it('filterFlashRows filters by join state', () => {
    const filters: FlashProductFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'all',
      selection: 'selected',
    };
    expect(
      filterFlashRows([winner, currentWins], { r1: 'h24' }, {}, filters).map((r) => r.id),
    ).toEqual(['r1']);
  });
});
