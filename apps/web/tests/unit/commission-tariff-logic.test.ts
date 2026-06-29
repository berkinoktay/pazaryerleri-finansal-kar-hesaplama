import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  filterRows,
  selectBestForAll,
  selectByTargetMargin,
  selectProfitableOnly,
  type TariffFilterState,
} from '@/features/campaigns/lib/bulk-actions';
import { estimateCustomPrice } from '@/features/campaigns/lib/estimate-custom-price';
import { MOCK_TARIFF_TEMPLATES } from '@/features/campaigns/lib/mock-commission-tariffs';

const firstTemplate = MOCK_TARIFF_TEMPLATES[0];
const firstPeriod = firstTemplate?.periods[0];
if (firstPeriod === undefined) throw new Error('mock period missing');
const rows = firstPeriod.rows;
const row = rows[0];
if (row === undefined) throw new Error('mock row missing');

const NO_FILTER: TariffFilterState = {
  query: '',
  category: null,
  brand: null,
  minMarginPct: null,
  profit: 'all',
  selection: 'all',
};

describe('estimateCustomPrice', () => {
  it('maps the current price to band1 and matches its profit', () => {
    const estimate = estimateCustomPrice(row, row.currentPrice);
    expect(estimate.band.key).toBe('band1');
    expect(estimate.profit.toFixed(2)).toBe(row.bands[0].profit.toFixed(2));
  });

  it('maps a price in the second range to band2 and matches its profit', () => {
    const estimate = estimateCustomPrice(row, row.bands[1].threshold);
    expect(estimate.band.key).toBe('band2');
    expect(estimate.profit.toFixed(2)).toBe(row.bands[1].profit.toFixed(2));
  });

  it('uses the lowest band for a very low price', () => {
    const estimate = estimateCustomPrice(row, new Decimal('1'));
    expect(estimate.band.key).toBe('band4');
  });
});

describe('bulk selection', () => {
  it('selectBestForAll chooses each row best band', () => {
    const selection = selectBestForAll(rows, {});
    for (const r of rows) expect(selection[r.id]).toBe(r.bestBand);
  });

  it('selectProfitableOnly skips rows whose best band loses money', () => {
    const selection = selectProfitableOnly(rows, {});
    for (const r of rows) {
      const best = r.bands.find((b) => b.key === r.bestBand);
      if (best !== undefined && best.profit.greaterThan(0)) {
        expect(selection[r.id]).toBe(r.bestBand);
      } else {
        expect(selection[r.id]).toBeUndefined();
      }
    }
  });

  it('selectByTargetMargin least-drop picks a band that meets the target', () => {
    const selection = selectByTargetMargin(rows, {}, 5, 'least-drop');
    for (const r of rows) {
      const key = selection[r.id];
      if (key === undefined || key === null) continue;
      const band = r.bands.find((b) => b.key === key);
      expect(band).toBeDefined();
      expect(Number(band?.marginPct)).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('filterRows', () => {
  it('returns all rows with the neutral filter', () => {
    expect(filterRows(rows, {}, NO_FILTER)).toHaveLength(rows.length);
  });

  it('filters by a minimum best-band margin', () => {
    const filtered = filterRows(rows, {}, { ...NO_FILTER, minMarginPct: 1000 });
    expect(filtered).toHaveLength(0);
  });
});
