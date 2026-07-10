import type { SyncLog, SyncType } from '@pazarsync/db';
import { parseProductsCursor } from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './handlers/types';

export type Registry = Partial<Record<SyncType, ModuleHandler>>;

/**
 * Decode the SyncLog.pageCursor for the syncType, then hand off to the
 * registered module handler. Throws if no handler is registered for the
 * SyncLog's type.
 */
export async function dispatch(
  registry: Registry,
  syncLog: SyncLog,
  workerId: string,
): Promise<ChunkResult> {
  const handler = registry[syncLog.syncType];
  if (handler === undefined) {
    throw new Error(`No handler registered for syncType=${syncLog.syncType}`);
  }
  const cursor = decodeCursor(syncLog);
  return handler.processChunk({ syncLog, cursor, workerId });
}

function decodeCursor(syncLog: SyncLog): unknown | null {
  switch (syncLog.syncType) {
    case 'PRODUCTS':
      return parseProductsCursor(syncLog.pageCursor);
    case 'ORDERS':
    case 'SETTLEMENTS':
    case 'CLAIMS':
      // future: dedicated parsers per module (CLAIMS is cursorless —
      // single-chunk 60d window scan, see handlers/claims.ts)
      return syncLog.pageCursor;
    default: {
      const _exhaustive: never = syncLog.syncType;
      throw new Error(`Unknown syncType: ${_exhaustive}`);
    }
  }
}
