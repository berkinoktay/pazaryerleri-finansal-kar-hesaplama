import { toUtcIsoDate } from '@pazarsync/utils';
import type { DateRange } from 'react-day-picker';

// Bridge between a page's date-range URL state (ISO `from`/`to` strings, empty
// meaning "no filter") and the react-day-picker DateRange the DateRangePicker
// speaks. Shared across pages (orders, returns, …) so every header filter slot
// uses one conversion instead of copying it inline.

/**
 * Build a DateRange from the URL's ISO `from`/`to` params. Returns undefined
 * when neither bound is set, so the DateRangePicker shows its placeholder.
 */
export function dateRangeFromParams(from: string, to: string): DateRange | undefined {
  if (from.length === 0 && to.length === 0) {
    return undefined;
  }
  return {
    from: from.length > 0 ? new Date(from) : undefined,
    to: to.length > 0 ? new Date(to) : undefined,
  };
}

/**
 * Project a selected DateRange back to the URL's ISO `from`/`to` params. An
 * unset bound becomes an empty string — the parsers' "no filter" sentinel.
 */
export function dateRangeToParams(next: DateRange | undefined): { from: string; to: string } {
  return {
    from: next?.from !== undefined ? toUtcIsoDate(next.from) : '',
    to: next?.to !== undefined ? toUtcIsoDate(next.to) : '',
  };
}
