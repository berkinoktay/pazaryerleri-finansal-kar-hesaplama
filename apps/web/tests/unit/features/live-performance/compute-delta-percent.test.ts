import { describe, expect, it } from 'vitest';

import { computeDeltaPercent } from '@/features/live-performance/lib/compute-delta-percent';

/**
 * Period-over-period percent change shared by all four live KPIs
 * (revenue, net profit, order count, margin). Inputs are Decimal strings
 * (orderCount arrives as a number but is passed through as a string by the
 * caller for one uniform delta path). Returns `null` when no meaningful
 * delta can be expressed — the KPI tile then renders without a TrendDelta chip.
 */
describe('computeDeltaPercent', () => {
  it('returns the positive percent change when today is higher than yesterday', () => {
    expect(computeDeltaPercent('1000', '800')).toBe(25);
  });

  it('returns the negative percent change when today is lower than yesterday', () => {
    expect(computeDeltaPercent('800', '1000')).toBe(-20);
  });

  it('returns -100 when today collapsed to zero from a non-zero yesterday', () => {
    expect(computeDeltaPercent('0', '100')).toBe(-100);
  });

  it('returns null when yesterday is zero (relative change is undefined)', () => {
    expect(computeDeltaPercent('500', '0')).toBeNull();
  });

  it('returns null when both days are zero', () => {
    expect(computeDeltaPercent('0', '0')).toBeNull();
  });

  it('preserves decimal precision from Decimal string inputs', () => {
    // 24.80 vs 22.70 → ((24.80 - 22.70) / 22.70) * 100 = 9.2511013...
    expect(computeDeltaPercent('24.80', '22.70')).toBeCloseTo(9.2511, 3);
  });
});
