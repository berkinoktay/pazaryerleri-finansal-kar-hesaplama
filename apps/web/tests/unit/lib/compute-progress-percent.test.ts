import { describe, expect, it } from 'vitest';

import { computeProgressPercent } from '@/lib/compute-progress-percent';

describe('computeProgressPercent', () => {
  it('returns the rounded whole percent for a known total', () => {
    expect(computeProgressPercent({ current: 128, total: 210 })).toBe(61);
    expect(computeProgressPercent({ current: 1, total: 3 })).toBe(33);
    expect(computeProgressPercent({ current: 0, total: 250 })).toBe(0);
  });

  it('clamps at 100 when current overshoots the total', () => {
    expect(computeProgressPercent({ current: 300, total: 250 })).toBe(100);
  });

  it('returns null when the total is unknown, zero, or negative', () => {
    expect(computeProgressPercent({ current: 5, total: null })).toBeNull();
    expect(computeProgressPercent({ current: 5, total: 0 })).toBeNull();
    expect(computeProgressPercent({ current: 5, total: -1 })).toBeNull();
  });

  it('returns null for a null or undefined progress pair', () => {
    expect(computeProgressPercent(null)).toBeNull();
    expect(computeProgressPercent(undefined)).toBeNull();
  });
});
