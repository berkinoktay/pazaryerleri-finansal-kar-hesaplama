import { getBusinessDayRangeOfDate } from '@pazarsync/utils';

/**
 * A `from`/`to` query pair whose values are business dates: date-only
 * `YYYY-MM-DD` strings the validator has already checked
 * (`businessDateQueryParam`).
 */
export interface BusinessDateRangeInput {
  readonly from?: string;
  readonly to?: string;
}

/**
 * The window a business-date query parameter must fall in, as `YYYY-MM-DD`
 * (string comparison orders such dates correctly). The day-range arithmetic
 * formats the date through Intl, which needs a four-digit year, so a hand-edited
 * `?to=9999-12-31` or `?from=0001-01-01` would otherwise end in a 500. No store
 * data lies outside this window. Validators answer a value outside it with
 * BUSINESS_DATE_OUT_OF_RANGE (422 VALIDATION_ERROR).
 */
export const BUSINESS_DATE_PARAM_MIN = '2000-01-01';
export const BUSINESS_DATE_PARAM_MAX = '2099-12-31';
export const BUSINESS_DATE_OUT_OF_RANGE = 'INVALID_DATE_OUT_OF_RANGE';

/** A Prisma instant filter covering whole business days. */
export interface BusinessDateRangeFilter {
  gte?: Date;
  lt?: Date;
}

/**
 * The instant filter for a business-date range: `gte` is the start of the
 * business day `from` names, `lt` is the end of the business day `to` names
 * (exclusive), so `to` includes that whole day. Undefined when neither bound is
 * set.
 */
export function businessDateRangeFilter(
  range: BusinessDateRangeInput,
): BusinessDateRangeFilter | undefined {
  if (range.from === undefined && range.to === undefined) {
    return undefined;
  }
  const filter: BusinessDateRangeFilter = {};
  if (range.from !== undefined) {
    filter.gte = getBusinessDayRangeOfDate(range.from).start;
  }
  if (range.to !== undefined) {
    filter.lt = getBusinessDayRangeOfDate(range.to).end;
  }
  return filter;
}
