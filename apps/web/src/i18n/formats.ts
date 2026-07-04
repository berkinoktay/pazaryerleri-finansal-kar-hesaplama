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
 *     formatter.dateTime(date, 'dayTime')    →  21 Nisan 2026 01:32  (no weekday)
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
    // Trendyol-style campaign period stamp — "30 Temmuz 2026 08:00" (day + month
    // name + year + time, NO weekday) for commission-tariff week windows.
    dayTime: {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
    weekday: { weekday: 'long' },
    month: { year: 'numeric', month: 'long' },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    amount: { minimumFractionDigits: 0, maximumFractionDigits: 2 },
    currency: { style: 'currency', currency: 'TRY' },
    /* Compact magnitude for chart axis ticks — "48 B", "1,2 Mn" (tr) — so a
       y-axis stays uncluttered while the tooltip/value carries full ₺. */
    compact: { notation: 'compact', maximumFractionDigits: 1 },
    /* Compact WITH the ₺ symbol — for a currency chart's y-axis so the axis
       reads "₺644" / "₺48 B" instead of a bare number. */
    compactCurrency: {
      style: 'currency',
      currency: 'TRY',
      notation: 'compact',
      maximumFractionDigits: 1,
    },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
    /* Whole-number percent — distribution shares / breakdown legends where a
       decimal ("%65,0") reads cluttered. Pass a 0..1 fraction. */
    percentInt: { style: 'percent', maximumFractionDigits: 0 },
    percentDelta: {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    },
  },
} as const satisfies Formats;
