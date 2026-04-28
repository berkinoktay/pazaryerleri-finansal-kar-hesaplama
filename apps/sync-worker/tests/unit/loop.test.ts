import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncLog } from '@pazarsync/db';

describe('runSyncToCompletion', () => {
  beforeEach(() => {
    // Each test registers its own vi.doMock factory; reset the registry
    // so the dynamic `await import('../../src/loop')` re-evaluates loop.ts
    // (and its transitive @pazarsync/sync-core import) under the fresh mock.
    vi.resetModules();
  });

  it('drives the handler until kind=done, ticking after each chunk', async () => {
    const fakeSyncLog = {
      id: 'log-1',
      syncType: 'PRODUCTS',
      progressCurrent: 0,
      pageCursor: null,
    } as unknown as SyncLog;
    const tickMock = vi.fn();
    const completeMock = vi.fn();

    const handler = {
      processChunk: vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'continue',
          cursor: { kind: 'page', n: 1 },
          progress: 100,
          total: 200,
          stage: 'upserting',
        })
        .mockResolvedValueOnce({
          kind: 'continue',
          cursor: { kind: 'page', n: 2 },
          progress: 200,
          total: 200,
          stage: 'upserting',
        })
        .mockResolvedValueOnce({ kind: 'done', finalCount: 200 }),
    };

    vi.doMock('@pazarsync/sync-core', () => ({
      syncLogService: {
        tick: tickMock,
        complete: completeMock,
        releaseToPending: vi.fn(),
      },
      // Dispatcher (transitively imported by loop) decodes the cursor via
      // this parser before calling the handler — passthrough is fine here.
      parseProductsCursor: (c: unknown) => c,
    }));

    const { runSyncToCompletion } = await import('../../src/loop');
    await runSyncToCompletion(fakeSyncLog, { PRODUCTS: handler } as never, () => false);

    expect(handler.processChunk).toHaveBeenCalledTimes(3);
    expect(tickMock).toHaveBeenCalledTimes(2); // ticks only on continue, not on done
    expect(completeMock).toHaveBeenCalledWith('log-1', 200);
  });

  it('stops between chunks when shuttingDown returns true and releases the row', async () => {
    const fakeSyncLog = {
      id: 'log-2',
      syncType: 'PRODUCTS',
      progressCurrent: 0,
      pageCursor: null,
    } as unknown as SyncLog;
    const releaseMock = vi.fn();

    const handler = {
      processChunk: vi.fn().mockResolvedValue({
        kind: 'continue',
        cursor: { kind: 'page', n: 1 },
        progress: 100,
        total: 999,
        stage: 'upserting',
      }),
    };

    vi.doMock('@pazarsync/sync-core', () => ({
      syncLogService: { tick: vi.fn(), complete: vi.fn(), releaseToPending: releaseMock },
      parseProductsCursor: (c: unknown) => c,
    }));

    const { runSyncToCompletion } = await import('../../src/loop');
    let shutdownTriggered = false;
    await runSyncToCompletion(fakeSyncLog, { PRODUCTS: handler } as never, () => {
      const was = shutdownTriggered;
      shutdownTriggered = true; // first call returns false, second returns true
      return was;
    });

    expect(releaseMock).toHaveBeenCalledWith('log-2');
  });
});
