/**
 * The exact settle point of a business day (same-day edit window, plan P1-14; notes B4).
 * Owner rule (Berkin 2026-11-23): an order's cost and desi are the values in force at
 * the end of its Istanbul business day T, and at 00:00 they become final.
 *
 * Every seller-input stamp is its transaction's start instant, so a transaction that
 * began before T can commit rows stamped <= T after T. The day-close pass and past-day
 * buffer graduation may therefore act on a day only when BOTH hold, read from the
 * database:
 *   1. the database clock is at or past T + SELLER_INPUT_SETTLE_MS, and
 *   2. no other client backend of this database has an open transaction that began
 *      before T + 1 ms. Stamps are `timestamp(3)` and Postgres rounds, so a
 *      transaction that starts within half a millisecond after T stamps exactly T; the
 *      extra millisecond waits for it too.
 * (2) fails closed: pg_stat_activity hides another session's state, start instant and
 * backend type from a role that is not a superuser, not a member of pg_read_all_stats
 * and not that session's role. Such a session may hold a transaction open since
 * before T, so it counts as an open writer without a start instant (`xactStart` null),
 * and a role that cannot read the view settles a day only at the cap, forced.
 * When (2) still fails at T + SELLER_INPUT_SETTLE_CAP_MS the cutoff moves anyway and
 * the result is `forced`, carrying the open transactions. The warning
 * (`seller-input.settle-forced`) is logged here, not by the callers: the forced result
 * is memoised, so only the first caller of the day sees `forced`.
 * Every seller-input writer also runs with SELLER_INPUT_TX_OPTIONS, whose timeout ends
 * such a transaction long before the settle delay (the second guard).
 *
 * Clock reads are UTC wall clocks, never `timestamptz`: @prisma/adapter-pg does not
 * convert a `timestamptz` result, it relabels its printed offset as +00:00, so
 * `SELECT now()` would read 3 h ahead in a session whose TimeZone is Europe/Istanbul
 * and move the cutoff to 21:00 Istanbul. `timezone('utc', ...)` yields a `timestamp`
 * the adapter reads as UTC in any session, and the day end is passed as an ISO instant
 * turned into a UTC wall clock in SQL (as the seller-input loader does), so the
 * session time zone never takes part in the comparison either.
 *
 * Memo: once no transaction that began before T + 1 ms is open, none can ever appear
 * again, so the first clean (or forced) result per day is kept in this process and the
 * activity view is not read again for that day. Only the most recently closed day can
 * be held back: every older day is past the cap.
 */

import { Prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import {
  getBusinessDayRange,
  previousDayStart,
  SELLER_INPUT_SETTLE_CAP_MS,
  SELLER_INPUT_SETTLE_MS,
} from '@pazarsync/utils';

/**
 * One other session of this database that may still write stamps <= a day end: a client
 * backend whose open transaction began before it, or a session whose activity is hidden
 * from this role.
 */
export interface OpenWriter {
  readonly pid: number;
  /**
   * The transaction's start instant (pg_stat_activity.xact_start), or null when the
   * session's activity is hidden from this role and it counts as open (fail closed).
   */
  readonly xactStart: Date | null;
}

/** How one open writer is logged: never a session's query text. */
export type OpenWriterLogEntry =
  | { readonly pid: number; readonly xactStart: string }
  | { readonly pid: number; readonly hidden: true };

/** The log entry of one open writer: its start instant, or `hidden` when the role cannot see it. */
export function openWriterLogEntry(writer: OpenWriter): OpenWriterLogEntry {
  if (writer.xactStart === null) {
    return { pid: writer.pid, hidden: true };
  }
  return { pid: writer.pid, xactStart: writer.xactStart.toISOString() };
}

/** The settled cutoff of one tick, read from the database clock. */
export interface SettledCutoff {
  /** The database clock when the cutoff was resolved. */
  readonly dbNow: Date;
  /** An order is settled when its business-day end T is at or before this instant. */
  readonly cutoff: Date;
  /**
   * True when the cap passed with writers still open (the cutoff moved anyway). Only the
   * first resolve of that day in this process sees it; the warning is already logged.
   */
  readonly forced: boolean;
  /** The open transactions that held the cutoff back, or that were overridden when forced. */
  readonly openWriters: readonly OpenWriter[];
}

/**
 * The day end (epoch ms) whose settle point this process has already passed, or null.
 * Monotonic per day: see the module comment.
 */
let settledDayEndMs: number | null = null;

/** Test seam: forgets the settled day, so the next resolve reads the activity view again. */
export function resetSettledCutoffMemo(): void {
  settledDayEndMs = null;
}

/** The database clock (the current transaction's start instant) as a UTC wall clock. */
export async function readDbNow(db: Prisma.TransactionClient): Promise<Date> {
  const rows = await db.$queryRaw<unknown[]>`SELECT timezone('utc', now()) AS now`;
  const row = rows[0];
  if (typeof row !== 'object' || row === null || !('now' in row) || !(row.now instanceof Date)) {
    throw new Error('the database clock read returned an unexpected row shape');
  }
  return row.now;
}

/**
 * True when `value` is one row of the open-writer query: a pid and a start instant, null
 * for a hidden session.
 */
function isOpenWriterRow(
  value: unknown,
): value is { readonly pid: number; readonly xact_start: Date | null } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'pid' in value &&
    typeof value.pid === 'number' &&
    'xact_start' in value &&
    (value.xact_start === null || value.xact_start instanceof Date)
  );
}

/**
 * The other sessions of this database that may still write stamps <= `dayEnd`, oldest
 * first, hidden ones last. The caller's own session is never counted.
 *  - Visible: a client backend whose open transaction began before `dayEnd` + 1 ms.
 *    An idle session (no transaction, `xact_start` null) never counts.
 *  - Hidden: pg_stat_activity nulls state, xact_start and backend_type of a session
 *    this role may not see (only datname and pid stay readable), so it cannot be told
 *    apart from an idle session or proven a client backend. Any such backend of this
 *    database counts, with a null `xactStart` (fail closed). A visible row has a
 *    backend type, so a reader that sees every session gets no hidden rows.
 */
export async function findTransactionsOpenSince(
  db: Prisma.TransactionClient,
  params: { readonly dayEnd: Date },
): Promise<readonly OpenWriter[]> {
  const dayEndUtc = Prisma.sql`(${params.dayEnd.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const rows = await db.$queryRaw<unknown[]>`
    SELECT pid, timezone('utc', xact_start) AS xact_start
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND (
             (backend_type = 'client backend'
              AND xact_start IS NOT NULL
              AND timezone('utc', xact_start) < ${dayEndUtc} + interval '1 millisecond')
          OR (state IS NULL AND backend_type IS NULL)
           )
     ORDER BY xact_start NULLS LAST, pid`;

  return rows.map((row) => {
    if (!isOpenWriterRow(row)) {
      throw new Error('the open-writer query returned an unexpected row shape');
    }
    return { pid: row.pid, xactStart: row.xact_start };
  });
}

/**
 * The settled cutoff now: the end of the most recently closed business day once that
 * day is settled (clock plus no open pre-midnight transaction, or forced past the cap),
 * else the start of that day. `opts.dbNow` is a test seam; production reads the
 * database clock.
 */
export async function resolveSettledCutoff(
  db: Prisma.TransactionClient,
  opts: { readonly dbNow?: Date } = {},
): Promise<SettledCutoff> {
  const dbNow = opts.dbNow ?? (await readDbNow(db));
  // The end of the most recently closed day (the start of the day dbNow is in).
  const latestEnd = getBusinessDayRange(dbNow).start;
  const latestEndMs = latestEnd.getTime();
  const heldBack = previousDayStart(latestEnd);

  // Before the settle delay: the clock alone holds the day back, no activity read.
  if (dbNow.getTime() < latestEndMs + SELLER_INPUT_SETTLE_MS) {
    return { dbNow, cutoff: heldBack, forced: false, openWriters: [] };
  }
  // This process already saw the day settled: nothing that began before T can reappear.
  if (settledDayEndMs === latestEndMs) {
    return { dbNow, cutoff: latestEnd, forced: false, openWriters: [] };
  }

  const openWriters = await findTransactionsOpenSince(db, { dayEnd: latestEnd });
  if (openWriters.length === 0) {
    settledDayEndMs = latestEndMs;
    return { dbNow, cutoff: latestEnd, forced: false, openWriters };
  }
  if (dbNow.getTime() < latestEndMs + SELLER_INPUT_SETTLE_CAP_MS) {
    return { dbNow, cutoff: heldBack, forced: false, openWriters };
  }
  // Re-checked after the await above: two callers started in the same worker tick can
  // both pass the earlier memo check, and only the first may warn.
  if (settledDayEndMs === latestEndMs) {
    return { dbNow, cutoff: latestEnd, forced: false, openWriters: [] };
  }
  settledDayEndMs = latestEndMs;
  // Once per day per process: the memo answers every later call of this day. Only the
  // pids and start instants (or `hidden`) are logged, never a session's query text.
  syncLog.warn('seller-input.settle-forced', {
    dayEnd: latestEnd.toISOString(),
    dbNow: dbNow.toISOString(),
    openWriters: openWriters.map(openWriterLogEntry),
  });
  return { dbNow, cutoff: latestEnd, forced: true, openWriters };
}
