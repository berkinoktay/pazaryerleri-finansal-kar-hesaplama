/**
 * When a business day's seller inputs (cost links, cost versions, desi) are settled
 * (same-day edit window, D6 and B4). Owner rule (Berkin 2026-11-23): an order's cost
 * and desi are the values in force at the end of its Istanbul business day, and at
 * 00:00 they become final.
 *
 * Every seller-input stamp is the writing transaction's start instant, so a
 * transaction that began before a day end T can still commit rows stamped <= T after
 * T. Two guards keep such a write from arriving after the day was finalised:
 *   - every transaction that can stamp seller-input history runs with
 *     `SELLER_INPUT_TX_OPTIONS`; a Prisma interactive transaction cannot commit after
 *     its timeout, and the settle wait outlasts that timeout several times over;
 *   - a day counts as settled only once the database clock has passed its end by
 *     `SELLER_INPUT_SETTLE_MS` (`clockSettledCutoff`). The caller may hold the cutoff
 *     back further while a transaction that began before T is still open, up to
 *     `SELLER_INPUT_SETTLE_CAP_MS`.
 *
 * Instants here are database-clock instants; the app clock is never compared with
 * database stamps.
 */

import { getBusinessDayRange } from './timezone';

/**
 * The wait after a business day ends before the day counts as settled: it covers
 * transactions that began before the day end and are still committing.
 */
export const SELLER_INPUT_SETTLE_MS = 120_000;

/** 15 min: after this an open writer no longer blocks. */
export const SELLER_INPUT_SETTLE_CAP_MS = 900_000;

/** Options of every transaction that can stamp seller-input history. */
export const SELLER_INPUT_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** Clock-only cutoff: start of the business day that contains dbNow - SETTLE. */
export function clockSettledCutoff(dbNow: Date): Date {
  return getBusinessDayRange(new Date(dbNow.getTime() - SELLER_INPUT_SETTLE_MS)).start;
}

/** Start of the business day before the one that starts at `dayStart`. */
export function previousDayStart(dayStart: Date): Date {
  // The last millisecond before a day start lies in the previous business day.
  return getBusinessDayRange(new Date(dayStart.getTime() - 1)).start;
}

/**
 * True when the order's day end T is at or before the cutoff. For the buffer's
 * `@db.Date` anchors the same comparison is `entry.orderDate < getBusinessDateAnchor(cutoff)`.
 */
export function isDaySettled(orderDate: Date, cutoff: Date): boolean {
  return getBusinessDayRange(orderDate).end.getTime() <= cutoff.getTime();
}
