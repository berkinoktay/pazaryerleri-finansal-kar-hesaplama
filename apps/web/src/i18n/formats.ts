import type { Formats } from 'next-intl';

/**
 * Shared date / time / number format presets.
 *
 * These are the **only** knobs the product uses for temporal and numeric
 * display. Consume through `useFormatter()` from next-intl:
 *
 *     formatter.dateTime(date, 'short')      →  21.04.2026 01:32
 *     formatter.dateTime(date, 'date')       →  21.04.2026
 *     formatter.dateTime(date, 'time')       →  01:32
 *     formatter.dateTime(date, 'long')       →  21 Nisan 2026 Salı 01:32
 *     formatter.dateTime(date, 'weekday')    →  Salı
 *     formatter.number(value, 'integer')     →  284.390
 *     formatter.number(value, 'currency')    →  ₺284.390,45
 *     formatter.number(value, 'percent')     →  21,4%
 *     formatter.number(value, 'percentDelta')→  +21,4%  (signed)
 *
 * All timestamps resolve to `Europe/Istanbul` via the global `timeZone`
 * setting in `request.ts`. To display something in another zone, pass
 * `timeZone` in the options inline — but prefer new named presets over
 * one-off overrides so the system stays consistent.
 *
 * Adding a new preset: add it here first, then consume by name. Never
 * hand-roll `{ dateStyle, timeStyle, ... }` objects in components.
 */
export const FORMATS = {
  dateTime: {
    short: { dateStyle: 'short', timeStyle: 'short' },
    date: { dateStyle: 'short' },
    time: { timeStyle: 'short' },
    long: { dateStyle: 'full', timeStyle: 'short' },
    weekday: { weekday: 'long' },
    month: { year: 'numeric', month: 'long' },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    currency: { style: 'currency', currency: 'TRY' },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
    percentDelta: {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    },
  },
} as const satisfies Formats;
