import { getBusinessDate, getBusinessDateAnchor, getCompletedDaysCutoff } from '@pazarsync/utils';

import { businessDateRangeFilter, type BusinessDateRangeInput } from './business-date-range';

/**
 * The completed-days view of one request: the orders list and its KPI summary
 * show only orders placed before the open (today's) Istanbul business day.
 * Built once per request from the API process clock (presentation only).
 */
export interface CompletedDaysScope {
  /** Start of the open business day (instant). Orders before it are on completed days. */
  readonly cutoff: Date;
  /** The open (today's) business date, YYYY-MM-DD. */
  readonly openBusinessDate: string;
  /** The last completed business date, YYYY-MM-DD. */
  readonly lastCompletedBusinessDate: string;
  /** The open business date as the UTC-midnight anchor used by @db.Date columns (the buffer). */
  readonly openDayAnchor: Date;
}

/**
 * A queued profit recompute stops counting toward `openDay.finalizing` once it has
 * failed this many times. The queue backs a failing row off (30 s doubling, capped at
 * an hour) but never drops it, so without this bound one order whose recompute keeps
 * throwing would hold the "still being finalised" note for good. Five failures span
 * about a quarter of an hour of retries, the same span as the page's finalising poll.
 */
export const FINALIZING_MAX_RECOMPUTE_ATTEMPTS = 5;

/** The completed-days scope at `now` (the API clock by default). */
export function completedDaysScope(now: Date = new Date()): CompletedDaysScope {
  const cutoff = getCompletedDaysCutoff(now);
  return {
    cutoff,
    openBusinessDate: getBusinessDate(now),
    // The last instant before the cutoff lies on the last completed business day.
    lastCompletedBusinessDate: getBusinessDate(new Date(cutoff.getTime() - 1)),
    openDayAnchor: getBusinessDateAnchor(now),
  };
}

/**
 * from/to bounds (business dates) clamped to completed days; always has `lt`.
 * `lt` is the earlier of the range's own end and the cutoff, so `to` on or after
 * today still stops at the last completed day. A `from` on or after today gives
 * `gte >= lt`, an empty window, with no special case.
 */
export function completedOrderDateFilter(
  range: BusinessDateRangeInput,
  scope: CompletedDaysScope,
): { gte?: Date; lt: Date } {
  const requested = businessDateRangeFilter(range);
  const requestedEnd = requested?.lt;
  const lt =
    requestedEnd !== undefined && requestedEnd.getTime() < scope.cutoff.getTime()
      ? requestedEnd
      : scope.cutoff;
  const gte = requested?.gte;
  return gte === undefined ? { lt } : { gte, lt };
}
