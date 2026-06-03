import { describe, expect, it } from 'vitest';

import { buildChartSeries } from '@/features/live-performance/lib/build-chart-series';

/**
 * Merges the API's two independent cumulative-profit arrays (`today`,
 * `yesterday`, each `{ hour, cumulativeProfit }`) into a single 24-row chart-kit
 * dataset `[{ hour, today?, yesterday }]` for the comparison LineChart.
 *
 * Two asymmetries model the "live today vs. completed yesterday" idiom:
 * - `yesterday` is a COMPLETE past day → present (forward-filled) for all 24
 *   hours, so the dashed reference line spans the full axis.
 * - `today` is IN PROGRESS → present only up to `currentHour`; later hours omit
 *   the key entirely so the subject line stops at "now" (where LineChart's
 *   `liveDot` marks the leading edge) instead of flat-lining into the future.
 *
 * Decimal strings are coerced to numbers (chart pixels — precision loss is
 * acceptable). Missing hours forward-fill the last cumulative value, since a
 * cumulative series does not drop when an hour has no new orders.
 */
describe('buildChartSeries', () => {
  it('always returns exactly 24 rows, hour 0..23', () => {
    const rows = buildChartSeries([], [], 23);
    expect(rows).toHaveLength(24);
    expect(rows[0]?.hour).toBe(0);
    expect(rows[23]?.hour).toBe(23);
  });

  it('zips dense 24-point series by hour and coerces Decimal strings to numbers', () => {
    const today = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      cumulativeProfit: (h * 10).toFixed(2),
    }));
    const yesterday = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      cumulativeProfit: (h * 5).toFixed(2),
    }));

    const rows = buildChartSeries(today, yesterday, 23);

    expect(rows[3]).toEqual({ hour: 3, today: 30, yesterday: 15 });
    expect(rows[23]).toEqual({ hour: 23, today: 230, yesterday: 115 });
  });

  it('omits the today key for hours after currentHour so the subject line stops at "now"', () => {
    const today = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      cumulativeProfit: (h * 10).toFixed(2),
    }));
    const yesterday = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      cumulativeProfit: (h * 5).toFixed(2),
    }));

    const rows = buildChartSeries(today, yesterday, 14);

    // Up to + including the current hour: today is present.
    expect(rows[14]?.today).toBe(140);
    expect('today' in (rows[14] ?? {})).toBe(true);
    // After the current hour: the today key is absent entirely (not 0 / null).
    expect('today' in (rows[15] ?? {})).toBe(false);
    expect('today' in (rows[23] ?? {})).toBe(false);
    // Yesterday (a completed day) still spans the whole axis.
    expect(rows[15]?.yesterday).toBe(75);
    expect(rows[23]?.yesterday).toBe(115);
  });

  it('forward-fills missing hours with the last cumulative value (up to currentHour)', () => {
    const today = [
      { hour: 0, cumulativeProfit: '10.00' },
      { hour: 2, cumulativeProfit: '30.00' },
    ];

    const rows = buildChartSeries(today, [], 5);

    expect(rows[0]?.today).toBe(10);
    expect(rows[1]?.today).toBe(10); // filled from hour 0
    expect(rows[2]?.today).toBe(30);
    expect(rows[5]?.today).toBe(30); // filled from hour 2
  });

  it('uses 0 before the first present point and for an empty series', () => {
    const today = [{ hour: 4, cumulativeProfit: '50.00' }];

    const rows = buildChartSeries(today, [], 10);

    expect(rows[0]?.today).toBe(0);
    expect(rows[3]?.today).toBe(0);
    expect(rows[4]?.today).toBe(50);
    expect(rows[10]?.yesterday).toBe(0); // empty yesterday series
  });

  it('preserves fractional cumulative values', () => {
    const today = [{ hour: 0, cumulativeProfit: '12.34' }];
    const rows = buildChartSeries(today, [], 0);
    expect(rows[0]?.today).toBe(12.34);
  });
});
