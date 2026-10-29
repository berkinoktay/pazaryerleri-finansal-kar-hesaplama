import { describe, expect, it, vi } from 'vitest';
import type { SyncLog } from '@pazarsync/db';

import { dispatch } from '../../src/dispatcher';

const MS_PER_HOUR = 60 * 60 * 1000;

describe('dispatcher', () => {
  it('routes PRODUCTS sync logs to the products handler', async () => {
    const syncLog = { syncType: 'PRODUCTS', id: 'log-1', pageCursor: null } as unknown as SyncLog;
    const handler = {
      processChunk: vi.fn().mockResolvedValue({ kind: 'done', finalCount: 0 }),
    };
    const fakeRegistry = { PRODUCTS: handler } as never;
    const result = await dispatch(fakeRegistry, syncLog, 'worker-test');
    expect(handler.processChunk).toHaveBeenCalledWith({
      syncLog,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');
  });

  it('throws on an unregistered syncType', async () => {
    const syncLog = { syncType: 'ORDERS', id: 'log-2', pageCursor: null } as unknown as SyncLog;
    await expect(dispatch({} as never, syncLog, 'worker-test')).rejects.toThrow(/no handler/i);
  });

  describe('PRODUCTS_CHANGES', () => {
    const windowEnd = Date.now();
    const validCursor = {
      phase: 'CONTENT_MODIFIED_DATE',
      page: 2,
      windowStart: windowEnd - MS_PER_HOUR,
      windowEnd,
    };

    function changesHandler() {
      return { processChunk: vi.fn().mockResolvedValue({ kind: 'done', finalCount: 0 }) };
    }

    it('passes a null pageCursor through as null (first chunk computes the window)', async () => {
      const syncLog = {
        syncType: 'PRODUCTS_CHANGES',
        id: 'log-3',
        pageCursor: null,
      } as unknown as SyncLog;
      const handler = changesHandler();

      await dispatch({ PRODUCTS_CHANGES: handler } as never, syncLog, 'worker-test');

      expect(handler.processChunk).toHaveBeenCalledWith({
        syncLog,
        cursor: null,
        workerId: 'worker-test',
      });
    });

    it('decodes a stored window cursor and hands it to the handler', async () => {
      const syncLog = {
        syncType: 'PRODUCTS_CHANGES',
        id: 'log-4',
        pageCursor: validCursor,
      } as unknown as SyncLog;
      const handler = changesHandler();

      await dispatch({ PRODUCTS_CHANGES: handler } as never, syncLog, 'worker-test');

      expect(handler.processChunk).toHaveBeenCalledWith({
        syncLog,
        cursor: validCursor,
        workerId: 'worker-test',
      });
    });

    it.each([
      ['an unknown phase', { ...validCursor, phase: 'STATUS_DATE' }],
      ['a negative page', { ...validCursor, page: -1 }],
      ['an empty window', { ...validCursor, windowStart: validCursor.windowEnd }],
      ['a products page cursor', { kind: 'page', n: 3 }],
    ])('rejects %s with a ZodError before reaching the handler', async (_label, pageCursor) => {
      const syncLog = {
        syncType: 'PRODUCTS_CHANGES',
        id: 'log-5',
        pageCursor,
      } as unknown as SyncLog;
      const handler = changesHandler();

      await expect(
        dispatch({ PRODUCTS_CHANGES: handler } as never, syncLog, 'worker-test'),
      ).rejects.toMatchObject({ name: 'ZodError' });
      expect(handler.processChunk).not.toHaveBeenCalled();
    });
  });
});
