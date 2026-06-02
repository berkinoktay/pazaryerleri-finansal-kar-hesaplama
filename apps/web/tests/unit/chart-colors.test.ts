import { describe, expect, it } from 'vitest';

import {
  getZeroGradientOffset,
  resolveSeriesColor,
  resolveValueColor,
} from '@/components/patterns/chart-colors';

describe('resolveSeriesColor', () => {
  it('returns the brand color for brand mode regardless of index', () => {
    expect(resolveSeriesColor('brand', 0)).toBe('var(--color-chart-1)');
    expect(resolveSeriesColor('brand', 5)).toBe('var(--color-chart-1)');
  });

  it('cycles the categorical palette by index and wraps past the last', () => {
    expect(resolveSeriesColor('categorical', 0)).toBe('var(--color-chart-1)');
    expect(resolveSeriesColor('categorical', 2)).toBe('var(--color-chart-3)');
    expect(resolveSeriesColor('categorical', 6)).toBe('var(--color-chart-1)');
  });

  it('uses the positive color as the resting semantic color', () => {
    expect(resolveSeriesColor('semantic', 0)).toBe('var(--color-chart-positive)');
  });
});

describe('resolveValueColor', () => {
  it('returns the positive color for a gain (incl. zero)', () => {
    expect(resolveValueColor(120)).toBe('var(--color-chart-positive)');
    expect(resolveValueColor(0)).toBe('var(--color-chart-positive)');
  });

  it('returns the negative color for a loss', () => {
    expect(resolveValueColor(-1)).toBe('var(--color-chart-negative)');
    expect(resolveValueColor(-460)).toBe('var(--color-chart-negative)');
  });
});

describe('getZeroGradientOffset', () => {
  it('returns 1 for an empty series', () => {
    expect(getZeroGradientOffset([])).toBe(1);
  });

  it('returns 1 when every value is >= 0 (entirely profit)', () => {
    expect(getZeroGradientOffset([0, 10, 5])).toBe(1);
  });

  it('returns 0 when every value is <= 0 (entirely loss)', () => {
    expect(getZeroGradientOffset([-3, -1, 0])).toBe(0);
  });

  it('splits at the zero-crossing fraction for mixed values', () => {
    // max 300, min -100 → 300 / (300 - (-100)) = 0.75
    expect(getZeroGradientOffset([-100, 200, 300])).toBeCloseTo(0.75, 5);
  });

  it('crosses at the midpoint for equal magnitude above and below', () => {
    expect(getZeroGradientOffset([-50, 50])).toBeCloseTo(0.5, 5);
  });
});
