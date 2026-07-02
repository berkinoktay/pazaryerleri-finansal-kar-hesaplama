import { describe, expect, it } from 'vitest';

import type { TariffFilterState } from '@/features/campaigns/lib/bulk-actions';
import {
  tariffFilterStateFromRows,
  tariffRowsFromFilterState,
} from '@/features/campaigns/lib/tariff-filter-fields';

const EMPTY: TariffFilterState = {
  query: '',
  category: null,
  brand: null,
  minMarginPct: null,
  profit: 'all',
  selection: 'all',
};

describe('tariffRowsFromFilterState', () => {
  it("emits no rows for the empty state (tri-state 'all' = no chip)", () => {
    expect(tariffRowsFromFilterState(EMPTY)).toEqual([]);
  });

  it('round-trips the full set (query excluded — it lives with the search box)', () => {
    const filters: TariffFilterState = {
      query: 'bayrak',
      category: 'Bayrak',
      brand: 'Alpaka',
      minMarginPct: 12.5,
      profit: 'loss',
      selection: 'selected',
    };
    const { query: _query, ...chipSlice } = filters;
    expect(tariffFilterStateFromRows(tariffRowsFromFilterState(filters))).toEqual(chipSlice);
  });
});

describe('tariffFilterStateFromRows', () => {
  it('emits explicit null/all for absent rows so removing a chip clears its dimension', () => {
    expect(tariffFilterStateFromRows([])).toEqual({
      category: null,
      brand: null,
      minMarginPct: null,
      profit: 'all',
      selection: 'all',
    });
  });

  it('degrades non-numeric margins and unknown enum values to "no filter"', () => {
    expect(
      tariffFilterStateFromRows([
        { id: 'a', field: 'minMargin', operator: 'gte', value: 'abc' },
        { id: 'b', field: 'profit', operator: 'eq', value: 'mega' },
        { id: 'c', field: 'selection', operator: 'eq', value: 'ALL' },
      ]),
    ).toEqual({ category: null, brand: null, minMarginPct: null, profit: 'all', selection: 'all' });
  });
});
