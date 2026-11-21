// Profit recompute tick (phase 3B, Task 9).
//
// The single consumer of the profit recompute queue. Each tick drains per-order
// marks through recomputeParcelProfit (every producer enqueues its own mark inside
// its own transaction), batch after batch, until the queue runs dry or the tick
// budget (PROFIT_RECOMPUTE_TICK_BUDGET_MS) is spent; whatever is left waits for the
// next tick. The batches run one after another, never in parallel. When a tick
// claimed nothing at all, it sweeps a batch of stale orders into the queue -- those
// with no best-known statement, or one stamped by an older engine version -- so a
// new engine version and the phase 3D backfill migrate themselves.
//
// The sweep is a full `orders` scan, so it is throttled (queue-review finding): it
// runs at most once every PROFIT_STALE_SWEEP_INTERVAL_MS, but immediately on the
// next tick while it is still finding work (catch-up). A single-process "running"
// flag skips an overlapping tick -- the 5 s interval (or a boot run) can fire again
// while a long drain is still going. The flag and the sweep bookkeeping live in the
// closure createProfitRecomputeTick builds, so each test gets a fresh tick with no
// shared state; the default instance below is the one index.ts drives.

import { prisma, type PrismaClient } from '@pazarsync/db';
import {
  PROFIT_RECOMPUTE_BATCH_SIZE,
  drainProfitRecomputeQueue,
  enqueueStaleProfitStatements,
  type DrainResult,
} from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

// How often the tick fires. index.ts runs the tick once on boot, then on this
// interval, exactly like the other sync-worker ticks. It is not the drain cadence
// under load -- a busy tick keeps draining batch after batch -- but the upper bound
// on how long a fresh mark waits before an idle worker picks it up. 5 s keeps the
// seller's profit numbers near-real-time after a webhook, cost edit or settlement.
export const PROFIT_RECOMPUTE_INTERVAL_MS = 5_000;

// How long one tick keeps starting new drain passes. The budget is checked between
// passes, so a tick can overrun it by one pass; it stays below the interval so a
// tick normally ends before the next one fires (an overlapping tick is skipped).
export const PROFIT_RECOMPUTE_TICK_BUDGET_MS = 4_000;

// The shortest gap between two stale sweeps once a sweep found no work. The sweep
// scans the whole `orders` table, so it must not run every 5 s in steady state.
// It can afford to be rare: every producer enqueues its own order inside its own
// transaction, so the sweep is only a safety net for a mark that never landed plus
// the engine-version migration engine (it re-stamps orders an older engine wrote).
// The first tick after every worker start sweeps regardless of this gap (lastSweepAt
// starts at 0), and a sweep that found work still re-runs on the very next tick
// (catch-up) -- so a one-hour gap only throttles a truly idle worker.
export const PROFIT_STALE_SWEEP_INTERVAL_MS = 3_600_000;

// How many stale orders one sweep enqueues. The drain then works through them in
// consecutive batches, usually within the next tick or two.
export const PROFIT_STALE_SWEEP_LIMIT = 500;

// What one tick did: skipped (a previous tick was still running), or the drain
// totals summed over every pass of the tick plus the number of stale orders swept
// (null when the tick did not sweep).
export interface ProfitRecomputeTickResult {
  readonly skipped: boolean;
  readonly drain: DrainResult | null;
  readonly swept: number | null;
}

// The running total a tick starts from before its first pass.
const EMPTY_DRAIN: DrainResult = {
  claimed: 0,
  changed: 0,
  unchanged: 0,
  failed: 0,
  unsupported: 0,
  failedOrderIds: [],
};

/** Adds one drain pass to the tick's running total. */
function addDrainPass(total: DrainResult, pass: DrainResult): DrainResult {
  return {
    claimed: total.claimed + pass.claimed,
    changed: total.changed + pass.changed,
    unchanged: total.unchanged + pass.unchanged,
    failed: total.failed + pass.failed,
    unsupported: total.unsupported + pass.unsupported,
    failedOrderIds: [...total.failedOrderIds, ...pass.failedOrderIds],
  };
}

/**
 * Writes the tick's log lines: one info line with the drain totals, only when
 * something happened so an idle worker does not spam a line every 5 s, and one warn
 * line with the failed order ids. A tick cut short by a failing pass marks both
 * lines `interrupted: true`.
 */
function logTick(drain: DrainResult, swept: number | null, interrupted: boolean): void {
  const marker = interrupted ? { interrupted: true } : {};
  if (drain.claimed > 0 || (swept !== null && swept > 0)) {
    syncLog.info('profit-recompute.tick', {
      claimed: drain.claimed,
      changed: drain.changed,
      unchanged: drain.unchanged,
      failed: drain.failed,
      unsupported: drain.unsupported,
      swept: swept ?? 0,
      ...marker,
    });
  }
  if (drain.failedOrderIds.length > 0) {
    syncLog.warn('profit-recompute.failed', { orderIds: [...drain.failedOrderIds], ...marker });
  }
}

/**
 * Builds a profit recompute tick over its own closure state (running flag, last
 * sweep time, whether the last sweep found work), so a test can make a fresh one.
 * `now` defaults to the wall clock and drives both the sweep throttle and the tick
 * budget; with a fixed `now` the budget is never spent, so only the queue running
 * dry (a short pass) stops the drain loop. `batchSize` and `tickBudgetMs` default to
 * PROFIT_RECOMPUTE_BATCH_SIZE and PROFIT_RECOMPUTE_TICK_BUDGET_MS and are injectable
 * for the multi-pass tests. A pass that throws ends the tick: the totals of the
 * passes completed before it are logged as interrupted, the sweep is skipped, and
 * the error is rethrown unchanged for the caller to log.
 */
export function createProfitRecomputeTick(deps: {
  db: PrismaClient;
  now?: () => number;
  batchSize?: number;
  tickBudgetMs?: number;
}): () => Promise<ProfitRecomputeTickResult> {
  const { db } = deps;
  const now = deps.now ?? ((): number => Date.now());
  const batchSize = deps.batchSize ?? PROFIT_RECOMPUTE_BATCH_SIZE;
  const tickBudgetMs = deps.tickBudgetMs ?? PROFIT_RECOMPUTE_TICK_BUDGET_MS;

  let running = false;
  let lastSweepAt = 0;
  let lastSweepFoundWork = false;

  return async function tick(): Promise<ProfitRecomputeTickResult> {
    // A long drain can outlast the interval; skip the overlapping tick rather than
    // run two drains at once.
    if (running) {
      return { skipped: true, drain: null, swept: null };
    }
    running = true;
    try {
      // Drain pass after pass, sequentially. A short pass means the queue has no
      // more due marks; a spent budget leaves the rest for the next tick.
      const startedAt = now();
      let drain = EMPTY_DRAIN;
      let pass: DrainResult;
      do {
        try {
          pass = await drainProfitRecomputeQueue(db, { batchSize });
        } catch (error) {
          // The passes before this one are already committed, so log their totals
          // rather than lose them, then rethrow unchanged: index.ts logs the error
          // itself (tick-error). The sweep does not run on this path.
          logTick(drain, null, true);
          throw error;
        }
        drain = addDrainPass(drain, pass);
      } while (pass.claimed >= batchSize && now() - startedAt < tickBudgetMs);

      let swept: number | null = null;
      if (drain.claimed === 0) {
        // Catch-up (the last sweep found work) runs immediately; otherwise wait out
        // the interval so an idle worker does not scan `orders` every 5 s.
        const sweepDue =
          lastSweepFoundWork || now() - lastSweepAt >= PROFIT_STALE_SWEEP_INTERVAL_MS;
        if (sweepDue) {
          swept = await enqueueStaleProfitStatements(db, { limit: PROFIT_STALE_SWEEP_LIMIT });
          lastSweepAt = now();
          lastSweepFoundWork = swept > 0;
        }
      }

      logTick(drain, swept, false);

      return { skipped: false, drain, swept };
    } finally {
      running = false;
    }
  };
}

/** The default tick index.ts drives, bound to the shared Prisma client. */
export const processProfitRecompute = createProfitRecomputeTick({ db: prisma });
