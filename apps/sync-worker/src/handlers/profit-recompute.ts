// Profit recompute tick (phase 3B, Task 9).
//
// The single consumer of the profit recompute queue. Each tick drains a batch of
// per-order marks through recomputeParcelProfit (every producer enqueues its own
// mark inside its own transaction). When the queue is empty, the tick sweeps a
// batch of stale orders into the queue -- those with no best-known statement, or
// one stamped by an older engine version -- so a new engine version and the phase
// 3D backfill migrate themselves.
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
  drainProfitRecomputeQueue,
  enqueueStaleProfitStatements,
  type DrainResult,
} from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

// The queue drain cadence. index.ts runs the tick once on boot, then on this
// interval, exactly like the other sync-worker ticks. 5 s keeps the seller's
// profit numbers near-real-time after a webhook, cost edit or settlement lands.
export const PROFIT_RECOMPUTE_INTERVAL_MS = 5_000;

// How many marks one drain pass claims. Each claimed mark is recomputed in its own
// short transaction, so this bounds the work (and the lock window) per tick.
export const PROFIT_RECOMPUTE_BATCH_SIZE = 50;

// The shortest gap between two stale sweeps once a sweep found no work. The sweep
// scans the whole `orders` table, so it must not run every 5 s in steady state.
export const PROFIT_STALE_SWEEP_INTERVAL_MS = 300_000;

// How many stale orders one sweep enqueues. The drain then works through them a
// batch at a time on the following ticks.
export const PROFIT_STALE_SWEEP_LIMIT = 500;

// What one tick did: skipped (a previous tick was still running), or a drain result
// plus the number of stale orders swept (null when the tick did not sweep).
export interface ProfitRecomputeTickResult {
  readonly skipped: boolean;
  readonly drain: DrainResult | null;
  readonly swept: number | null;
}

/**
 * Builds a profit recompute tick over its own closure state (running flag, last
 * sweep time, whether the last sweep found work), so a test can make a fresh one.
 * `now` is injectable for the sweep-throttle test and defaults to the wall clock.
 */
export function createProfitRecomputeTick(deps: {
  db: PrismaClient;
  now?: () => number;
}): () => Promise<ProfitRecomputeTickResult> {
  const { db } = deps;
  const now = deps.now ?? ((): number => Date.now());

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
      const drain = await drainProfitRecomputeQueue(db, {
        batchSize: PROFIT_RECOMPUTE_BATCH_SIZE,
      });

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

      // One log line, only when something happened, so an idle worker does not spam
      // a line every 5 s.
      if (drain.claimed > 0 || (swept !== null && swept > 0)) {
        syncLog.info('profit-recompute.tick', {
          claimed: drain.claimed,
          changed: drain.changed,
          unchanged: drain.unchanged,
          failed: drain.failed,
          swept: swept ?? 0,
        });
      }
      if (drain.failedOrderIds.length > 0) {
        syncLog.warn('profit-recompute.failed', { orderIds: [...drain.failedOrderIds] });
      }

      return { skipped: false, drain, swept };
    } finally {
      running = false;
    }
  };
}

/** The default tick index.ts drives, bound to the shared Prisma client. */
export const processProfitRecompute = createProfitRecomputeTick({ db: prisma });
