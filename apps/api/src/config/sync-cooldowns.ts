/**
 * Manual-sync cooldown policy. Single source of truth for how long a user
 * must wait between two MANUAL sync triggers for the same (store, syncType).
 *
 * A second manual trigger inside the window is rejected with 429 RATE_LIMITED
 * and a `Retry-After` of the remaining seconds. Only MANUAL rows count — the
 * scheduled (CRON) and store-connect (BOOTSTRAP) fan-outs never trip it, so an
 * automated sync can't block a user's refresh.
 *
 * ORDERS is a cheap, time-sensitive scan (sellers want fresh order state), so
 * it gets the short window. PRODUCTS / PRODUCTS_DELTA / SETTLEMENTS / CLAIMS
 * are heavier full-window walks that rarely change minute-to-minute, so they
 * get the long window.
 *
 * `Record<SyncType, number>` is exhaustive on purpose: adding a new SyncType
 * member fails the build here until its cooldown is declared, so no sync type
 * can ship without an explicit policy.
 */

import type { SyncType } from '@pazarsync/db';

const SECONDS_PER_MINUTE = 60;
const SHORT_WINDOW_SECONDS = 5 * SECONDS_PER_MINUTE;
const LONG_WINDOW_SECONDS = 30 * SECONDS_PER_MINUTE;

export const MANUAL_SYNC_COOLDOWN_SECONDS: Record<SyncType, number> = {
  ORDERS: SHORT_WINDOW_SECONDS,
  PRODUCTS: LONG_WINDOW_SECONDS,
  PRODUCTS_DELTA: LONG_WINDOW_SECONDS,
  SETTLEMENTS: LONG_WINDOW_SECONDS,
  CLAIMS: LONG_WINDOW_SECONDS,
};
