import type { SyncLog } from '@pazarsync/db';
import { syncLogService } from '@pazarsync/sync-core';

import { dispatch, type Registry } from './dispatcher';

/**
 * Drive a claimed SyncLog through chunks until done or shutdown.
 *
 * Each iteration calls the registered module handler for one chunk and
 * either:
 *   - terminates the run (kind=done) → marks the log COMPLETED and exits, or
 *   - persists progress (kind=continue) → ticks the log and re-enters the
 *     loop with the new cursor/progress on the in-memory copy.
 *
 * Throws on chunk error — the outer claim loop catches and decides
 * FAILED vs FAILED_RETRYABLE.
 *
 * Shutdown contract: `shuttingDown()` is checked between chunks (never
 * mid-chunk — chunks are atomic w.r.t. their own DB writes). When it
 * flips to true the loop hands the row back to PENDING via
 * `releaseToPending` so another worker can pick up where this one left
 * off; the persisted `pageCursor` is the resume point.
 */
export async function runSyncToCompletion(
  syncLog: SyncLog,
  registry: Registry,
  shuttingDown: () => boolean,
): Promise<void> {
  let workingLog: SyncLog = syncLog;

  while (!shuttingDown()) {
    const result = await dispatch(registry, workingLog);

    if (result.kind === 'done') {
      await syncLogService.complete(workingLog.id, result.finalCount);
      return;
    }

    await syncLogService.tick(workingLog.id, {
      cursor: result.cursor,
      progress: result.progress,
      total: result.total,
      stage: result.stage,
    });

    workingLog = {
      ...workingLog,
      progressCurrent: result.progress,
      progressTotal: result.total,
      pageCursor: result.cursor as never, // jsonb (documented Prisma JSON exception)
    };
  }

  // Graceful shutdown path: hand the row back to PENDING.
  await syncLogService.releaseToPending(workingLog.id);
}
