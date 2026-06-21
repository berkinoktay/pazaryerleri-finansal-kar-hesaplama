// Database-connectivity reporter for the worker's many error paths.
//
// When Postgres is unreachable (e.g. `supabase start` forgotten in local
// dev), the boot reconcile/resolution runs PLUS the poll loop PLUS every
// background tick each throw the same Prisma "Can't reach database server"
// error — a scary, repeating multi-line wall. This reporter collapses that
// noise: the FIRST unreachable error logs one calm, actionable warning; while
// down, repeats are suppressed except a throttled heartbeat; the first
// successful DB interaction logs a single "reconnected" line.
//
// A NON-database error is never swallowed — it passes straight through to a
// normal error log with its original event name, so real failures stay loud.
//
// Stateful, so it's a factory (closes over the down-state) with a single
// process-wide instance exported for index.ts; tests build their own.

import { parseDbUnreachableError, syncLog, type LogContext } from '@pazarsync/sync-core';

const STILL_DOWN_HEARTBEAT_MS = 60_000;

const UNREACHABLE_HINT =
  'Database unreachable. Is Supabase running? Try `supabase start`. ' +
  'The worker is idling and will resume automatically once the connection returns.';

export interface DbConnectivityReporter {
  /**
   * Log a background/tick error. DB-unreachable errors are routed to the
   * throttled connectivity warning; everything else logs as an error under
   * `event`.
   */
  logBackgroundError(event: string, err: unknown, ctx?: LogContext): void;
  /** Note a successful DB interaction; logs `db.reconnected` once if we were down. */
  reportDbHealthy(): void;
}

export function createDbConnectivityReporter(): DbConnectivityReporter {
  // null = believed connected. A timestamp = the instant we first saw it down.
  let downSinceMs: number | null = null;
  let lastReportMs = 0;

  function logBackgroundError(event: string, err: unknown, ctx: LogContext = {}): void {
    const unreachable = parseDbUnreachableError(err);
    if (unreachable === null) {
      syncLog.error(event, {
        ...ctx,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const host = unreachable.host ?? undefined;
    const port = unreachable.port ?? undefined;
    const now = Date.now();

    if (downSinceMs === null) {
      downSinceMs = now;
      lastReportMs = now;
      syncLog.warn('db.unreachable', { host, port, hint: UNREACHABLE_HINT });
      return;
    }

    if (now - lastReportMs >= STILL_DOWN_HEARTBEAT_MS) {
      lastReportMs = now;
      syncLog.warn('db.unreachable.still', {
        host,
        port,
        downForSec: Math.round((now - downSinceMs) / 1000),
      });
    }
    // Otherwise: suppressed — no spam between heartbeats.
  }

  function reportDbHealthy(): void {
    if (downSinceMs === null) return;
    const downForSec = Math.round((Date.now() - downSinceMs) / 1000);
    downSinceMs = null;
    lastReportMs = 0;
    syncLog.info('db.reconnected', { downForSec });
  }

  return { logBackgroundError, reportDbHealthy };
}

/** Process-wide instance shared by every error path in `index.ts`. */
export const dbConnectivity = createDbConnectivityReporter();
