// Unit tests for the profit recompute tick (phase 3B, Task 9).
//
// The queue drain and the stale sweep are mocked (`@pazarsync/profit`) and the
// logger is mocked (`@pazarsync/sync-core`), so these tests exercise only the
// tick's own logic: the overlap skip, the throttled sweep decision, and the
// log-only-when-something-happened rule. `now` is injected to drive the throttle
// deterministically.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@pazarsync/db';
import {
  drainProfitRecomputeQueue,
  enqueueCarrierGapRecomputes,
  enqueueReferenceDataGapRecomputes,
  enqueueStaleProfitStatements,
} from '@pazarsync/profit';
import type { DrainResult } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import {
  createProfitRecomputeTick,
  PROFIT_GAP_SWEEP_LIMIT,
  PROFIT_RECOMPUTE_TICK_BUDGET_MS,
  PROFIT_STALE_SWEEP_INTERVAL_MS,
} from '../../../src/handlers/profit-recompute';

// The default batch size comes from the real package, so the tick's fallback is
// exercised against the one shared value; only the drain and the sweeps are mocked.
vi.mock('@pazarsync/profit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pazarsync/profit')>();
  return {
    PROFIT_RECOMPUTE_BATCH_SIZE: actual.PROFIT_RECOMPUTE_BATCH_SIZE,
    drainProfitRecomputeQueue: vi.fn(),
    enqueueStaleProfitStatements: vi.fn(),
    enqueueCarrierGapRecomputes: vi.fn(),
    enqueueReferenceDataGapRecomputes: vi.fn(),
  };
});

vi.mock('@pazarsync/sync-core', () => ({
  syncLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The tick never touches `db` directly (drain/sweep are mocked), so a bare stub is
// enough to satisfy the signature.
const db = {} as unknown as PrismaClient;

const drainMock = vi.mocked(drainProfitRecomputeQueue);
const sweepMock = vi.mocked(enqueueStaleProfitStatements);
const carrierGapMock = vi.mocked(enqueueCarrierGapRecomputes);
const referenceGapMock = vi.mocked(enqueueReferenceDataGapRecomputes);
const infoMock = vi.mocked(syncLog.info);
const warnMock = vi.mocked(syncLog.warn);

/** An empty drain: nothing claimed, so the tick considers the sweep. */
function emptyDrain(): DrainResult {
  return { claimed: 0, changed: 0, unchanged: 0, failed: 0, unsupported: 0, failedOrderIds: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  // The gap-fill sweeps find nothing unless a test says otherwise.
  carrierGapMock.mockResolvedValue(0);
  referenceGapMock.mockResolvedValue(0);
});

describe('createProfitRecomputeTick', () => {
  it('skips a tick while the previous one is still running', async () => {
    // The first drain never resolves on its own; we hold it pending so the first
    // tick is mid-flight when the second runs.
    let releaseFirst: (result: DrainResult) => void = () => {};
    const pending = new Promise<DrainResult>((resolve) => {
      releaseFirst = resolve;
    });
    drainMock.mockReturnValueOnce(pending);

    const tick = createProfitRecomputeTick({ db, now: () => 0 });

    const first = tick(); // runs to the drain await, sets the running flag
    const second = await tick(); // sees running === true -> skipped

    expect(second).toEqual({
      skipped: true,
      drain: null,
      swept: null,
      carrierGapSwept: null,
      referenceGapSwept: null,
    });
    expect(drainMock).toHaveBeenCalledTimes(1);

    releaseFirst(emptyDrain());
    const firstResult = await first;
    expect(firstResult.skipped).toBe(false);
  });

  it('sweeps only when the queue is empty and the interval elapsed, or while catching up', async () => {
    drainMock.mockResolvedValue(emptyDrain());

    let clock = PROFIT_STALE_SWEEP_INTERVAL_MS; // first tick is already interval-due from boot (lastSweepAt = 0)
    const tick = createProfitRecomputeTick({ db, now: () => clock });

    // A non-empty drain never sweeps, whatever the clock says.
    drainMock.mockResolvedValueOnce({
      claimed: 2,
      changed: 2,
      unchanged: 0,
      failed: 0,
      unsupported: 0,
      failedOrderIds: [],
    });
    const busy = await tick();
    expect(busy.swept).toBeNull();
    expect(sweepMock).not.toHaveBeenCalled();

    // Queue empty and the interval has elapsed since boot -> sweep. It found no work.
    sweepMock.mockResolvedValueOnce(0);
    const firstSweep = await tick();
    expect(firstSweep.swept).toBe(0);
    expect(sweepMock).toHaveBeenCalledTimes(1);

    // A little later, still within the interval, last sweep found nothing -> no sweep.
    clock += 1_000;
    const notDue = await tick();
    expect(notDue.swept).toBeNull();
    expect(sweepMock).toHaveBeenCalledTimes(1);

    // A full interval later -> due again; this time the sweep found work.
    clock += PROFIT_STALE_SWEEP_INTERVAL_MS;
    sweepMock.mockResolvedValueOnce(7);
    const dueAgain = await tick();
    expect(dueAgain.swept).toBe(7);
    expect(sweepMock).toHaveBeenCalledTimes(2);

    // Catch-up: the last sweep found work, so the next tick sweeps immediately even
    // though no interval has elapsed.
    clock += 1;
    sweepMock.mockResolvedValueOnce(0);
    const catchUp = await tick();
    expect(catchUp.swept).toBe(0);
    expect(sweepMock).toHaveBeenCalledTimes(3);
  });

  it('runs both gap-fill sweeps exactly when the stale sweep runs, and logs their counts', async () => {
    drainMock.mockResolvedValue(emptyDrain());
    sweepMock.mockResolvedValue(0);

    let clock = PROFIT_STALE_SWEEP_INTERVAL_MS;
    const tick = createProfitRecomputeTick({ db, now: () => clock });

    // A non-empty drain runs no sweep at all.
    drainMock.mockResolvedValueOnce({
      claimed: 1,
      changed: 1,
      unchanged: 0,
      failed: 0,
      unsupported: 0,
      failedOrderIds: [],
    });
    await tick();
    expect(carrierGapMock).not.toHaveBeenCalled();
    expect(referenceGapMock).not.toHaveBeenCalled();

    // Queue empty and the interval elapsed: the stale sweep and both gap-fill sweeps
    // run, each with its limit, and the info line carries every count.
    carrierGapMock.mockResolvedValueOnce(3);
    referenceGapMock.mockResolvedValueOnce(2);
    const swept = await tick();
    expect(swept).toMatchObject({ swept: 0, carrierGapSwept: 3, referenceGapSwept: 2 });
    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(carrierGapMock).toHaveBeenCalledTimes(1);
    expect(carrierGapMock).toHaveBeenCalledWith(db, { limit: PROFIT_GAP_SWEEP_LIMIT });
    expect(referenceGapMock).toHaveBeenCalledTimes(1);
    expect(referenceGapMock).toHaveBeenCalledWith(db, { limit: PROFIT_GAP_SWEEP_LIMIT });
    expect(infoMock).toHaveBeenLastCalledWith(
      'profit-recompute.tick',
      expect.objectContaining({ swept: 0, carrierGapSwept: 3, referenceGapSwept: 2 }),
    );

    // A gap sweep found work, so the next tick catches up immediately.
    clock += 1;
    const catchUp = await tick();
    expect(catchUp).toMatchObject({ swept: 0, carrierGapSwept: 0, referenceGapSwept: 0 });
    expect(carrierGapMock).toHaveBeenCalledTimes(2);
    expect(referenceGapMock).toHaveBeenCalledTimes(2);

    // Nothing found and the interval not elapsed: no sweep of any kind.
    clock += 1;
    const idle = await tick();
    expect(idle).toMatchObject({ swept: null, carrierGapSwept: null, referenceGapSwept: null });
    expect(sweepMock).toHaveBeenCalledTimes(2);
    expect(carrierGapMock).toHaveBeenCalledTimes(2);
    expect(referenceGapMock).toHaveBeenCalledTimes(2);
  });

  it('logs only when something happened', async () => {
    const tick = createProfitRecomputeTick({ db, now: () => 0 });

    // Idle: empty drain and (now 0, lastSweepAt 0) is not interval-due -> no sweep,
    // nothing happened -> no info line.
    drainMock.mockResolvedValueOnce(emptyDrain());
    await tick();
    expect(infoMock).not.toHaveBeenCalled();

    // Work drained -> one info line carrying the counts.
    drainMock.mockResolvedValueOnce({
      claimed: 3,
      changed: 2,
      unchanged: 1,
      failed: 0,
      unsupported: 0,
      failedOrderIds: [],
    });
    await tick();
    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith(
      'profit-recompute.tick',
      expect.objectContaining({
        claimed: 3,
        changed: 2,
        unchanged: 1,
        failed: 0,
        unsupported: 0,
        swept: 0,
      }),
    );

    // Failed orders -> a warn with the ids.
    drainMock.mockResolvedValueOnce({
      claimed: 1,
      changed: 0,
      unchanged: 0,
      failed: 1,
      unsupported: 0,
      failedOrderIds: ['order-x'],
    });
    await tick();
    expect(warnMock).toHaveBeenCalledWith('profit-recompute.failed', { orderIds: ['order-x'] });
  });

  it('sums every pass of a multi-pass tick into one result and one log line', async () => {
    // Two full batches, then a short one: the short pass ends the tick. A fixed clock
    // never spends the budget, so only the short pass stops the loop.
    drainMock
      .mockResolvedValueOnce({
        claimed: 2,
        changed: 1,
        unchanged: 0,
        failed: 1,
        unsupported: 0,
        failedOrderIds: ['a'],
      })
      .mockResolvedValueOnce({
        claimed: 2,
        changed: 0,
        unchanged: 1,
        failed: 0,
        unsupported: 1,
        failedOrderIds: [],
      })
      .mockResolvedValueOnce({
        claimed: 1,
        changed: 0,
        unchanged: 0,
        failed: 1,
        unsupported: 0,
        failedOrderIds: ['b'],
      });

    const tick = createProfitRecomputeTick({ db, now: () => 0, batchSize: 2 });
    const result = await tick();

    expect(result).toEqual({
      skipped: false,
      drain: {
        claimed: 5,
        changed: 1,
        unchanged: 1,
        failed: 2,
        unsupported: 1,
        failedOrderIds: ['a', 'b'],
      },
      swept: null,
      carrierGapSwept: null,
      referenceGapSwept: null,
    });
    expect(drainMock).toHaveBeenCalledTimes(3);
    expect(sweepMock).not.toHaveBeenCalled();

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith('profit-recompute.tick', {
      claimed: 5,
      changed: 1,
      unchanged: 1,
      failed: 2,
      unsupported: 1,
      swept: 0,
      carrierGapSwept: 0,
      referenceGapSwept: 0,
    });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith('profit-recompute.failed', { orderIds: ['a', 'b'] });
  });

  it('stops starting new passes once the tick budget is spent', async () => {
    // The clock reads 0 at the start, just under the budget after the first pass,
    // and exactly the budget from then on. The queue always has a full batch for
    // three passes (then runs dry), so only the budget can stop the tick after two.
    const readings = [0, PROFIT_RECOMPUTE_TICK_BUDGET_MS - 1];
    const now = (): number => readings.shift() ?? PROFIT_RECOMPUTE_TICK_BUDGET_MS;
    const fullBatch: DrainResult = {
      claimed: 1,
      changed: 1,
      unchanged: 0,
      failed: 0,
      unsupported: 0,
      failedOrderIds: [],
    };
    drainMock
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValue(emptyDrain());

    const tick = createProfitRecomputeTick({ db, now, batchSize: 1 });
    const result = await tick();

    expect(result.drain?.claimed).toBe(2);
    expect(drainMock).toHaveBeenCalledTimes(2);
  });

  it('logs the completed passes and rethrows when a pass fails midway', async () => {
    const failure = new Error('drain pass failed');
    drainMock
      .mockResolvedValueOnce({
        claimed: 2,
        changed: 1,
        unchanged: 0,
        failed: 1,
        unsupported: 0,
        failedOrderIds: ['a'],
      })
      .mockRejectedValueOnce(failure);

    const tick = createProfitRecomputeTick({ db, now: () => 0, batchSize: 2 });

    // The very same error reaches the caller (index.ts logs it as tick-error).
    await expect(tick()).rejects.toBe(failure);
    expect(drainMock).toHaveBeenCalledTimes(2);
    expect(sweepMock).not.toHaveBeenCalled();

    // The first pass is already committed, so its totals are logged, marked as
    // interrupted.
    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith('profit-recompute.tick', {
      claimed: 2,
      changed: 1,
      unchanged: 0,
      failed: 1,
      unsupported: 0,
      swept: 0,
      carrierGapSwept: 0,
      referenceGapSwept: 0,
      interrupted: true,
    });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith('profit-recompute.failed', {
      orderIds: ['a'],
      interrupted: true,
    });

    // The running flag was released: the next tick runs instead of being skipped.
    drainMock.mockResolvedValueOnce(emptyDrain());
    const next = await tick();
    expect(next.skipped).toBe(false);
  });
});
