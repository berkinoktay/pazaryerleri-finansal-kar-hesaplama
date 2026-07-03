import { describe, expect, it } from 'vitest';

import {
  clearSelections,
  filterRows,
  selectBestForAll,
  selectByTargetMargin,
  selectProfitableOnly,
  type CommissionSelectionState,
  type TariffFilterState,
} from '@/features/campaigns/lib/bulk-actions';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

/** An empty choice state — no band chosen, no custom prices. */
function emptyState(): CommissionSelectionState {
  return { selection: {}, customPrices: {} };
}

function band(
  key: string,
  price: string,
  netProfit: string | null,
  marginPct: string | null,
): PriceBand {
  return {
    key,
    lowerLimit: null,
    upperLimit: price,
    price,
    commissionPct: '10',
    netProfit,
    marginPct,
  };
}

function row(
  id: string,
  bestBandKey: string | null,
  bands: PriceBand[],
  overrides: Partial<CommissionTariffRow> = {},
): CommissionTariffRow {
  return {
    id,
    barcode: id,
    stockCode: id,
    productTitle: id,
    imageUrl: null,
    category: 'Cat',
    brand: 'Brand',
    currentPrice: '100',
    currentCommissionPct: '10',
    currentNetProfit: '5',
    currentMarginPct: '5',
    calculable: true,
    reason: null,
    bestBandKey,
    selectedBand: null,
    customPrice: null,
    bands,
    ...overrides,
  };
}

// r1: band2 best (profit 30, margin 20). r2: band1 best (profit 40) but band3 has the higher margin (25).
const r1 = row('r1', 'band2', [
  band('band1', '150', '10', '8'),
  band('band2', '120', '30', '20'),
  band('band3', '90', '20', '25'),
]);
const r2 = row('r2', 'band1', [band('band1', '200', '40', '15'), band('band2', '160', '-5', '-3')]);
const rows: CommissionTariffRow[] = [r1, r2];

describe('bulk-actions', () => {
  it('selectBestForAll assigns each row its server bestBandKey', () => {
    const next = selectBestForAll(rows, emptyState());
    expect(next.selection).toEqual({ r1: 'band2', r2: 'band1' });
  });

  it('selectBestForAll clears a row custom price it overwrites', () => {
    const state: CommissionSelectionState = {
      selection: { r1: 'band3' },
      customPrices: { r1: { price: '95', netProfit: '20', marginPct: '25' } },
    };
    const next = selectBestForAll([r1], state);
    expect(next.selection.r1).toBe('band2');
    expect(next.customPrices.r1).toBeNull();
  });

  it('selectProfitableOnly skips rows whose best band is not profitable', () => {
    const loser = row('r3', 'band1', [band('band1', '50', '-10', '-20')]);
    const next = selectProfitableOnly([r1, loser], emptyState());
    expect(next.selection.r1).toBe('band2');
    expect(next.selection.r3).toBeUndefined();
  });

  it('selectByTargetMargin (max-profit) picks the most profitable band meeting the target', () => {
    // target 20%: r1 → band2 (margin 20, profit 30) & band3 (margin 25, profit 20) qualify → max-profit = band2.
    const next = selectByTargetMargin([r1], emptyState(), 20, 'max-profit');
    expect(next.selection.r1).toBe('band2');
  });

  it('selectByTargetMargin (least-drop) picks the highest-price qualifying band', () => {
    // target 20%: band2 (price 120) & band3 (price 90) qualify → least-drop = band2 (higher price).
    const next = selectByTargetMargin([r1], emptyState(), 20, 'least-drop');
    expect(next.selection.r1).toBe('band2');
  });

  it('clearSelections removes the given rows band AND custom price', () => {
    const state: CommissionSelectionState = {
      selection: { r1: 'band2', r2: 'band1' },
      customPrices: { r1: { price: '110', netProfit: '30', marginPct: '20' } },
    };
    const next = clearSelections([r1], state);
    expect(next.selection).toEqual({ r2: 'band1' });
    expect(next.customPrices.r1).toBeUndefined();
  });

  it('filterRows filters by profit status over the best band', () => {
    const lossRow = row('r4', 'band1', [band('band1', '50', '-10', '-20')]);
    const filters: TariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'profitable',
      selection: 'all',
    };
    const result = filterRows([r1, lossRow], {}, filters);
    expect(result.map((r) => r.id)).toEqual(['r1']);
  });

  it('filterRows tolerates null category/margin without crashing', () => {
    const nullRow = row('r5', null, [band('band1', '50', null, null)], {
      category: null,
      brand: null,
    });
    const filters: TariffFilterState = {
      query: '',
      category: null,
      brand: null,
      minMarginPct: 10,
      profit: 'all',
      selection: 'all',
    };
    // minMarginPct=10 with a null best margin → excluded, no throw.
    expect(filterRows([nullRow], {}, filters)).toHaveLength(0);
  });
});
