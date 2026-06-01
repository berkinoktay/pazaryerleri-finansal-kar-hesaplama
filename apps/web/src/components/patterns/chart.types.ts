/**
 * Shared types for the PazarSync chart kit (patterns/chart-*).
 *
 * Leaf module — depends on nothing in the kit so every chart file can import
 * it without cycles. Runtime helpers live in `chart-colors.ts` /
 * `chart-format.ts`; visual shells in `chart-frame.tsx` / `chart-states.tsx`.
 */

/**
 * How a chart resolves series colors:
 * - `semantic` — value-driven kâr=yeşil / zarar=kırmızı (P&L default).
 * - `categorical` — qualitative palette `--chart-1..6` for breakdowns,
 *   rankings, multi-series.
 * - `brand` — single brand violet for a neutral metric with no +/- meaning
 *   (e.g. order count).
 */
export type ChartColorMode = 'semantic' | 'categorical' | 'brand';

/** Numeric display format for a series' tooltip / axis values. */
export type ChartValueFormat = 'currency' | 'percent' | 'number';

/** Derived render state of a chart, driven by the consumer's query. */
export type ChartStatus = 'ready' | 'loading' | 'empty' | 'error';

export interface ChartSeries {
  /** Key into each datum object. */
  key: string;
  /** Localized, human-readable series name (legend / tooltip). */
  label: string;
  /** Value format; defaults to `'number'`. */
  format?: ChartValueFormat;
}

export interface ChartPeriodOption {
  value: string;
  label: string;
}

export interface ChartPeriodControl {
  value: string;
  options: ReadonlyArray<ChartPeriodOption>;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
}

/** A single chart datum: an x-key plus one or more numeric series values. */
export type ChartDatum = Record<string, number | string>;
