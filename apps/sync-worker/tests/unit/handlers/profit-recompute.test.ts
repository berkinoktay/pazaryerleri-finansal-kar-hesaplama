// Unit tests for the profit recompute tick (phase 3B, Task 9).
//
// The queue drain and the stale sweep are mocked (`@pazarsync/profit`) and the
// logger is mocked (`@pazarsync/sync-core`), so these tests exercise only the
// tick's own logic: the overlap skip, the throttled sweep decision, and the
// log-only-when-something-happened rule. `now` is injected to drive the throttle
// deterministically.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@pazarsync/db';
import { drainProfitRecomputeQueue, enqueueStaleProfitStatements } from '@pazarsync/profit';
import type { DrainResult } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import {
  createProfitRecomputeTick,
  PROFIT_STALE_SWEEP_INTERVAL_MS,
} from '../../../src/handlers/profit-recompute';

vi.mock('@pazarsync/profit', () => ({
  drainProfitRecomputeQueue: vi.fn(),
  enqueueStaleProfitStatements: vi.fn(),
}));

vi.mock('@pazarsync/sync-core', () => ({
  syncLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The tick never touches `db` directly (drain/sweep are mocked), so a bare stub is
// enough to satisfy the signature.
const db = {} as unknown as PrismaClient;

const drainMock = vi.mocked(drainProfitRecomputeQueue);
const sweepMock = vi.mocked(enqueueStaleProfitStatements);
const infoMock = vi.mocked(syncLog.info);
const warnMock = vi.mocked(syncLog.warn);

/** An empty drain: nothing claimed, so the tick considers the sweep. */
function emptyDrain(): DrainResult {
  return { claimed: 0, changed: 0, unchanged: 0, failed: 0, unsupported: 0, failedOrderIds: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
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

    expect(second).toEqual({ skipped: true, drain: null, swept: null });
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
});
