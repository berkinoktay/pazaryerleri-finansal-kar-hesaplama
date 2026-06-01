/**
 * Chart color resolution — token-first. Every value here is a `var(--color-*)`
 * reference so charts swap correctly in dark mode (never raw `--chart-N` or
 * hex; see apps/web/CLAUDE.md "Dark-mode discipline").
 */

import type { ChartColorMode } from './chart.types';

/** Qualitative palette, in assignment order, for categorical series. */
const CATEGORICAL_VARS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
] as const;

export const CHART_POSITIVE = 'var(--color-chart-positive)';
export const CHART_NEGATIVE = 'var(--color-chart-negative)';
export const CHART_BRAND = 'var(--color-chart-1)';
export const CHART_ZERO_LINE = 'var(--color-border-strong)';
/**
 * Neutral stroke for a comparison / reference series (e.g. "Dün"). Deliberately
 * a muted gray — never a semantic or brand color — so the reference reads as
 * secondary and never competes with the subject series it sits behind.
 */
export const CHART_COMPARISON = 'var(--color-muted-foreground)';

/**
 * Resolve a series' resting stroke/fill color from the color mode + index.
 * `semantic` returns the positive color as the resting value; the actual
 * green/red split is applied per-value at render time (see
 * `getZeroGradientOffset`).
 */
export function resolveSeriesColor(mode: ChartColorMode, index: number): string {
  switch (mode) {
    case 'brand':
      return CHART_BRAND;
    case 'categorical':
      return CATEGORICAL_VARS[index % CATEGORICAL_VARS.length];
    case 'semantic':
      return CHART_POSITIVE;
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unhandled chart color mode: ${_exhaustive}`);
    }
  }
}

/**
 * Fraction (0..1 measured from the TOP of the plot) at which the series
 * crosses zero — the hard-stop offset for a gradient that switches from the
 * positive color (above) to the negative color (below) at the zero baseline.
 *
 * - all values ≥ 0  → `1` (entirely positive, no red)
 * - all values ≤ 0  → `0` (entirely negative, no green)
 * - mixed           → `max / (max - min)`
 *
 * Zero is always included in the range so a flat-zero series reads positive.
 */
export function getZeroGradientOffset(values: readonly number[]): number {
  if (values.length === 0) return 1;
  let max = 0;
  let min = 0;
  for (const value of values) {
    if (value > max) max = value;
    if (value < min) min = value;
  }
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}
