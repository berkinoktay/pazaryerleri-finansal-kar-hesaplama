import { describe, expect, it, vi } from 'vitest';
import type { SyncLog } from '@pazarsync/db';

import { dispatch } from '../../src/dispatcher';

describe('dispatcher', () => {
  it('routes PRODUCTS sync logs to the products handler', async () => {
    const syncLog = { syncType: 'PRODUCTS', id: 'log-1', pageCursor: null } as unknown as SyncLog;
    const handler = {
      processChunk: vi.fn().mockResolvedValue({ kind: 'done', finalCount: 0 }),
    };
    const fakeRegistry = { PRODUCTS: handler } as never;
    const result = await dispatch(fakeRegistry, syncLog);
    expect(handler.processChunk).toHaveBeenCalledWith({ syncLog, cursor: null });
    expect(result.kind).toBe('done');
  });

  it('throws on an unregistered syncType', async () => {
    const syncLog = { syncType: 'ORDERS', id: 'log-2', pageCursor: null } as unknown as SyncLog;
    await expect(dispatch({} as never, syncLog)).rejects.toThrow(/no handler/i);
  });
});
