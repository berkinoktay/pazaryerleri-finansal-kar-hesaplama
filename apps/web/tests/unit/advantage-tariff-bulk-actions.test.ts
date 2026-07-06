import { describe, expect, it } from 'vitest';

import type {
  AdvantageBand,
  AdvantageTariffRow,
  NonNullStarTierKey,
} from '@/features/campaigns/lib/adapt-advantage-tariff';
import {
  bandForKey,
  bestBand,
  clearSelections,
  filterAdvantageRows,
  isJoinedRow,
  selectBestForAll,
  selectProfitable,
  type AdvantageSelectionState,
  type AdvantageTariffFilterState,
} from '@/features/campaigns/lib/advantage-bulk-actions';

/** An empty choice state — nothing joined, no custom prices. */
function emptyState(): AdvantageSelectionState {
  return { selection: {}, customPrices: {} };
}

/** One star tier as a band-like option. */
function tier(
  key: NonNullStarTierKey,
  netProfit: string | null,
  marginPct: string | null,
  price = '500',
): AdvantageBand {
  return { key, price, commissionPct: '13', netProfit, marginPct };
}

/**
 * The default three-tier row (`bands.length === 3`): the MIDDLE tier (`tier2`) carries the
 * highest profit, so the holistic winner is `tier2` — a fixture that proves the resolver
 * isn't just picking the first tier.
 */
function row(id: string, overrides: Partial<AdvantageTariffRow> = {}): AdvantageTariffRow {
  return {
    id,
    barcode: id,
    stockCode: id,
    productTitle: id,
    imageUrl: null,
    category: 'Cat',
    brand: 'Brand',
    size: null,
    stock: null,
    currentPrice: '100',
    customerPrice: '100',
    hasCommissionTariff: true,
    currentCommissionPct: '10',
    currentNetProfit: '5',
    currentMarginPct: '5',
    calculable: true,
    reason: null,
    selectedTier: null,
    customPrice: null,
    bands: [tier('tier1', '10', '8'), tier('tier2', '30', '20'), tier('tier3', '20', '15')],
    ...overrides,
  };
}

// winner: a tier (tier2) beats doing nothing. currentWins: the current price (50) beats
// every tier. uncalc: no calculable figures at all.
const winner = row('r1');
const currentWins = row('r2', {
  currentNetProfit: '50',
  bands: [tier('tier1', '10', '8'), tier('tier2', '8', '6'), tier('tier3', '5', '4')],
});
const uncalc = row('r3', {
  calculable: false,
  currentNetProfit: null,
  currentMarginPct: null,
  bands: [tier('tier1', null, null), tier('tier2', null, null), tier('tier3', null, null)],
});

describe('advantage bulk-actions', () => {
  it('selectBestForAll selects the winning tier, leaves current-wins rows unselected, skips uncalculable', () => {
    const next = selectBestForAll([winner, currentWins, uncalc], emptyState());
    // winner → its best tier (tier2), currentWins → null (keeping current wins). The
    // uncalculable row is left untouched (can't join).
    expect(next.selection).toEqual({ r1: 'tier2', r2: null });
    expect(next.selection.r3).toBeUndefined();
    // Both touched rows also drop any custom price (the two maps stay exclusive).
    expect(next.customPrices).toEqual({ r1: null, r2: null });
  });

  it('selectBestForAll clears a custom price the winning tier overwrites', () => {
    // A committed custom (30) ties the winning tier's profit (30) — a tie does NOT let the
    // custom win, so the tier takes the row and the custom is cleared.
    const state: AdvantageSelectionState = {
      selection: { r1: 'tier1' },
      customPrices: { r1: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = selectBestForAll([winner], state);
    expect(next.selection.r1).toBe('tier2');
    expect(next.customPrices.r1).toBeNull();
  });

  it('selectBestForAll preserves a committed custom price that wins the row', () => {
    // The custom estimate (100) strictly beats every tier (≤30) and the current price (5),
    // so the custom commitment is kept and the tier selection is cleared.
    const custom = { price: '999', netProfit: '100', marginPct: '50' };
    const state: AdvantageSelectionState = {
      selection: { r1: 'tier1' },
      customPrices: { r1: custom },
    };
    const next = selectBestForAll([winner], state);
    expect(next.selection.r1).toBeNull();
    expect(next.customPrices.r1).toEqual(custom);
  });

  it('selectProfitable selects only rows where a tier wins, leaving the rest untouched', () => {
    const next = selectProfitable([winner, currentWins], emptyState());
    expect(next.selection.r1).toBe('tier2');
    // currentWins keeps its current price → not touched at all (absent, not set to null).
    expect(next.selection.r2).toBeUndefined();
  });

  it('selectProfitable switches a low custom-priced winner to the winning tier', () => {
    // The committed custom (5) loses to the tier (30) → the tier takes the row, custom cleared.
    const state: AdvantageSelectionState = {
      selection: {},
      customPrices: { r1: { price: '450', netProfit: '5', marginPct: '3' } },
    };
    const next = selectProfitable([winner], state);
    expect(next.selection.r1).toBe('tier2');
    expect(next.customPrices.r1).toBeNull();
  });

  it('selectProfitable preserves a committed custom price that beats every tier', () => {
    // A custom (100) that wins the holistic race is not a tier win → the row is untouched.
    const custom = { price: '999', netProfit: '100', marginPct: '50' };
    const next = selectProfitable([winner], { selection: {}, customPrices: { r1: custom } });
    expect(next.selection.r1).toBeUndefined();
    expect(next.customPrices.r1).toEqual(custom);
  });

  it('clearSelections clears both the tier and the custom price of the listed rows only', () => {
    const state: AdvantageSelectionState = {
      selection: { r1: 'tier2', r2: 'tier1' },
      customPrices: { r1: { price: '450', netProfit: '30', marginPct: '20' } },
    };
    const next = clearSelections([winner], state);
    expect(next.selection.r1).toBeNull();
    expect(next.customPrices.r1).toBeNull();
    // r2 was not in the listed rows → untouched.
    expect(next.selection.r2).toBe('tier1');
  });

  it('bandForKey returns the tier for a key and undefined when that tier is absent', () => {
    expect(bandForKey(winner, 'tier2')?.netProfit).toBe('30');
    const partial = row('r9', { bands: [tier('tier1', '10', '8')] });
    expect(bandForKey(partial, 'tier2')).toBeUndefined();
  });

  it('isJoinedRow is true for a tier OR a custom price, false otherwise', () => {
    expect(isJoinedRow({ r1: 'tier1' }, {}, 'r1')).toBe(true);
    expect(isJoinedRow({}, { r1: { price: '1', netProfit: null, marginPct: null } }, 'r1')).toBe(
      true,
    );
    expect(isJoinedRow({}, {}, 'r1')).toBe(false);
    expect(isJoinedRow({ r1: null }, {}, 'r1')).toBe(false);
  });

  it('bestBand picks the most profitable tier and never a null-profit one', () => {
    expect(bestBand(winner)?.key).toBe('tier2');
    const withNull = row('rn', {
      bands: [tier('tier1', null, null), tier('tier2', '5', '3')],
    });
    expect(bestBand(withNull)?.key).toBe('tier2');
    const allNull = row('ra', { calculable: false, bands: [tier('tier1', null, null)] });
    expect(bestBand(allNull)).toBeUndefined();
  });

  it('filterAdvantageRows filters by the best-tier profit sign', () => {
    const filters: AdvantageTariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'profitable',
      selection: 'all',
    };
    const lossRow = row('rl', {
      bands: [tier('tier1', '-5', '-3'), tier('tier2', '-2', '-1'), tier('tier3', '-1', '-1')],
    });
    expect(filterAdvantageRows([winner, lossRow], {}, {}, filters).map((r) => r.id)).toEqual([
      'r1',
    ]);
  });

  it('filterAdvantageRows tolerates a null best-tier margin without crashing', () => {
    const nullRow = row('r5', {
      calculable: false,
      currentNetProfit: null,
      bands: [tier('tier1', null, null)],
      category: null,
      brand: null,
    });
    const filters: AdvantageTariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: 10,
      profit: 'all',
      selection: 'all',
    };
    // minMarginPct=10 with a null best-tier margin → excluded, no throw.
    expect(filterAdvantageRows([nullRow], {}, {}, filters)).toHaveLength(0);
  });

  it('filterAdvantageRows filters by join state', () => {
    const filters: AdvantageTariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'all',
      selection: 'selected',
    };
    expect(
      filterAdvantageRows([winner, currentWins], { r1: 'tier1' }, {}, filters).map((r) => r.id),
    ).toEqual(['r1']);
  });
});
