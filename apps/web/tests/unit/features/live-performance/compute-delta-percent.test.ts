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

  it('returns the percent change for fractional decimal strings', () => {
    expect(computeDeltaPercent('12.5', '10')).toBe(25);
  });

  // Net profit and margin can be negative. The sign of the delta must say
  // whether today is better, so the change is divided by |yesterday|.
  it('reports a recovery from a loss as a positive change', () => {
    // -271.30 → 50.56: (50.56 - (-271.30)) / 271.30 = 1.18636...
    expect(computeDeltaPercent('50.56', '-271.30')).toBeCloseTo(118.636, 2);
  });

  it('reports a deeper loss as a negative change', () => {
    // -100 → -150: (-150 - (-100)) / 100 = -50%
    expect(computeDeltaPercent('-150', '-100')).toBe(-50);
  });

  it('reports a loss that shrank as a positive change', () => {
    // -100 → -25: (-25 - (-100)) / 100 = +75%
    expect(computeDeltaPercent('-25', '-100')).toBe(75);
  });

  // The API sends null for yesterday's profit and the four ratios when the day
  // has no costed order; no relative change can be expressed then.
  it('returns null when yesterday is null (no costed order yesterday)', () => {
    expect(computeDeltaPercent('10', null)).toBeNull();
  });

  it('returns null when today is null (no costed order today)', () => {
    expect(computeDeltaPercent(null, '10')).toBeNull();
  });
});
