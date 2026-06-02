/**
 * Chart value formatting — routes a series' `ChartValueFormat` through the
 * shared next-intl presets in `src/i18n/formats.ts`. Never hand-rolls
 * `Intl.NumberFormat`; new shapes get a preset there first.
 */

import { useFormatter } from 'next-intl';

import type { ChartValueFormat } from './chart.types';

export type ChartFormatFn = (value: number, format?: ChartValueFormat) => string;

/** Full-precision formatter for tooltips and headline values. */
export function useChartValueFormatter(): ChartFormatFn {
  const formatter = useFormatter();
  return (value, format = 'number') => {
    switch (format) {
      case 'currency':
        return formatter.number(value, 'currency');
      case 'percent':
        return `${formatter.number(value, 'amount')}%`;
      case 'number':
        return formatter.number(value, 'amount');
      default: {
        const _exhaustive: never = format;
        throw new Error(`Unhandled chart value format: ${_exhaustive}`);
      }
    }
  };
}

/**
 * Compact formatter for axis ticks — magnitude only (no ₺) so a y-axis stays
 * light while the tooltip/value carries full precision. Percent ticks keep a
 * whole-number `%` suffix.
 */
export function useChartAxisFormatter(): ChartFormatFn {
  const formatter = useFormatter();
  return (value, format = 'number') => {
    switch (format) {
      case 'currency':
        return formatter.number(value, 'compactCurrency');
      case 'percent':
        return `${formatter.number(value, 'integer')}%`;
      case 'number':
        return formatter.number(value, 'compact');
      default: {
        const _exhaustive: never = format;
        throw new Error(`Unhandled chart value format: ${_exhaustive}`);
      }
    }
  };
}
