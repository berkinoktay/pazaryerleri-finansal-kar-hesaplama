import { getBusinessDayRange, getCompletedDaysCutoff } from '@pazarsync/utils';

const NOON_OFFSET_MS = 12 * 60 * 60 * 1000;

/**
 * Noon Istanbul of the business day `daysAgo` days before today (default 1).
 * Date.now()-relative. The orders list and its summary show only completed
 * business days, so a fixture that must be listed sits on one of these. Walks
 * back day by day with the business-day helpers, never `daysAgo * 24h` on the
 * instant. Every call with the same `daysAgo` returns the same instant: date two
 * orders with different `daysAgo` values when a test depends on their order.
 */
export function completedBusinessDayInstant(daysAgo = 1): Date {
  if (!Number.isInteger(daysAgo) || daysAgo < 1) {
    throw new Error(`completedBusinessDayInstant needs a whole daysAgo >= 1, got ${daysAgo}`);
  }
  let dayStart = getCompletedDaysCutoff();
  for (let step = 0; step < daysAgo; step += 1) {
    dayStart = getBusinessDayRange(new Date(dayStart.getTime() - 1)).start;
  }
  return new Date(dayStart.getTime() + NOON_OFFSET_MS);
}

/** An instant inside the open business day that is not in the future (now). */
export function openBusinessDayInstant(): Date {
  return new Date();
}
