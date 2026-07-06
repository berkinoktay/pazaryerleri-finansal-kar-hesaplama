import { toUtcIsoDate } from '@pazarsync/utils';
import type { DateRange } from 'react-day-picker';

// Bridge between the orders page URL state (ISO `from`/`to` strings, empty
// meaning "no filter") and the react-day-picker DateRange the DateRangePicker
// speaks. Kept here as the single source of truth so the header filter slot and
// any future caller share one conversion instead of copying it inline.

/**
 * Build a DateRange from the URL's ISO `from`/`to` params. Returns undefined
 * when neither bound is set, so the DateRangePicker shows its placeholder.
 */
export function orderDateRangeFromParams(from: string, to: string): DateRange | undefined {
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
export function orderDateRangeToParams(next: DateRange | undefined): { from: string; to: string } {
  return {
    from: next?.from !== undefined ? toUtcIsoDate(next.from) : '',
    to: next?.to !== undefined ? toUtcIsoDate(next.to) : '',
  };
}
