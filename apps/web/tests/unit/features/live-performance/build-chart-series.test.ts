import { describe, expect, it } from 'vitest';

import {
  buildChartSeries,
  type CumulativePoint,
} from '@/features/live-performance/lib/build-chart-series';

/**
 * Merges the API's two independent cumulative arrays (`today`, `yesterday`, each
 * `{ hour, cumulativeRevenue, cumulativeProfit }`) into a single 24-row chart-kit
 * dataset `[{ hour, today?, yesterday }]` for the comparison LineChart, reading
 * the field named by `metric` (the ciro/kâr toggle).
 *
 * Two asymmetries model "live today vs. completed yesterday":
 * - `yesterday` is COMPLETE → present (forward-filled) for all 24 hours.
 * - `today` is IN PROGRESS → present only up to `currentHour`; later hours omit
 *   the key so the subject line stops at "now".
 */
describe('buildChartSeries', () => {
  /** A 24-point dense series where revenue = hour×r and profit = hour×p. */
  function series(r: number, p: number): CumulativePoint[] {
    return Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      cumulativeRevenue: (h * r).toFixed(2),
      cumulativeProfit: (h * p).toFixed(2),
    }));
  }

  it('always returns exactly 24 rows, hour 0..23', () => {
    const rows = buildChartSeries([], [], 23, 'profit');
    expect(rows).toHaveLength(24);
    expect(rows[0]?.hour).toBe(0);
    expect(rows[23]?.hour).toBe(23);
  });

  it('plots the profit field when metric is "profit"', () => {
    const rows = buildChartSeries(series(20, 10), series(8, 5), 23, 'profit');
    expect(rows[3]).toEqual({ hour: 3, today: 30, yesterday: 15 });
    expect(rows[23]).toEqual({ hour: 23, today: 230, yesterday: 115 });
  });

  it('plots the revenue field when metric is "revenue"', () => {
    const rows = buildChartSeries(series(20, 10), series(8, 5), 23, 'revenue');
    expect(rows[3]).toEqual({ hour: 3, today: 60, yesterday: 24 });
    expect(rows[23]).toEqual({ hour: 23, today: 460, yesterday: 184 });
  });

  it('omits the today key for hours after currentHour so the subject line stops at "now"', () => {
    const rows = buildChartSeries(series(20, 10), series(8, 5), 14, 'profit');
    expect(rows[14]?.today).toBe(140);
    expect('today' in (rows[14] ?? {})).toBe(true);
    expect('today' in (rows[15] ?? {})).toBe(false);
    expect('today' in (rows[23] ?? {})).toBe(false);
    expect(rows[15]?.yesterday).toBe(75);
    expect(rows[23]?.yesterday).toBe(115);
  });

  it('forward-fills missing hours with the last cumulative value (up to currentHour)', () => {
    const today: CumulativePoint[] = [
      { hour: 0, cumulativeRevenue: '20.00', cumulativeProfit: '10.00' },
      { hour: 2, cumulativeRevenue: '60.00', cumulativeProfit: '30.00' },
    ];
    const rows = buildChartSeries(today, [], 5, 'profit');
    expect(rows[0]?.today).toBe(10);
    expect(rows[1]?.today).toBe(10); // filled from hour 0
    expect(rows[2]?.today).toBe(30);
    expect(rows[5]?.today).toBe(30); // filled from hour 2
  });

  it('uses 0 before the first present point and for an empty series', () => {
    const today: CumulativePoint[] = [
      { hour: 4, cumulativeRevenue: '100.00', cumulativeProfit: '50.00' },
    ];
    const rows = buildChartSeries(today, [], 10, 'profit');
    expect(rows[0]?.today).toBe(0);
    expect(rows[3]?.today).toBe(0);
    expect(rows[4]?.today).toBe(50);
    expect(rows[10]?.yesterday).toBe(0);
  });

  it('preserves fractional cumulative values', () => {
    const today: CumulativePoint[] = [
      { hour: 0, cumulativeRevenue: '99.99', cumulativeProfit: '12.34' },
    ];
    const rows = buildChartSeries(today, [], 0, 'profit');
    expect(rows[0]?.today).toBe(12.34);
  });
});
