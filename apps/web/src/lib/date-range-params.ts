import type { DateRange } from 'react-day-picker';

// Bridge between a page's date-range URL state (`YYYY-MM-DD` `from`/`to`
// strings, empty meaning "no filter") and the react-day-picker DateRange the
// DateRangePicker speaks. Shared across pages (orders, returns, …) so every
// header filter slot uses one conversion instead of copying it inline.
//
// The picker works in local calendar days (its Dates are local midnights), and
// the URL carries that same calendar day: the backend reads each param as a
// business date and selects that whole business day. Reading UTC components
// here would shift the day back by one for every pick east of UTC.

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local calendar day of `date` as `YYYY-MM-DD`. */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The local midnight of the `YYYY-MM-DD` calendar day `value`. Anything that is
 * not a date-only string gives an Invalid Date, as a malformed param always has.
 */
function parseLocalIsoDate(value: string): Date {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return new Date(Number.NaN);
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Build a DateRange from the URL's `from`/`to` params. Returns undefined when
 * neither bound is set, so the DateRangePicker shows its placeholder.
 */
export function dateRangeFromParams(from: string, to: string): DateRange | undefined {
  if (from.length === 0 && to.length === 0) {
    return undefined;
  }
  return {
    from: from.length > 0 ? parseLocalIsoDate(from) : undefined,
    to: to.length > 0 ? parseLocalIsoDate(to) : undefined,
  };
}

/**
 * The picker Date (local midnight) of the business date `value` (`YYYY-MM-DD`),
 * for bounds such as the DateRangePicker's `disabledAfter`. Undefined for an
 * empty or malformed value, so no Invalid Date reaches the Calendar.
 */
export function businessDateToPickerDate(value: string): Date | undefined {
  const date = parseLocalIsoDate(value);
  // The round trip rejects a day the month does not have: `Date` rolls
  // `2026-13-40` over into a later, valid day instead of failing.
  if (Number.isNaN(date.getTime()) || toLocalIsoDate(date) !== value) {
    return undefined;
  }
  return date;
}

/**
 * Project a selected DateRange back to the URL's `from`/`to` params. An unset
 * bound becomes an empty string — the parsers' "no filter" sentinel.
 */
export function dateRangeToParams(next: DateRange | undefined): { from: string; to: string } {
  return {
    from: next?.from !== undefined ? toLocalIsoDate(next.from) : '',
    to: next?.to !== undefined ? toLocalIsoDate(next.to) : '',
  };
}
