import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';

/**
 * Hard ceiling on how many times a single sync_logs row is claimed.
 * Once `attempt_count` reaches this value the row is no longer claimable
 * (see the WHERE clause below) and the watchdog reaper terminates it so
 * it can never starve the per-(store, type) slot. The worker's retry
 * classifier (`run-error.ts`) imports this constant so the "give up"
 * ceiling and the "not claimable" ceiling stay in lock-step.
 */
export const MAX_SYNC_ATTEMPTS = 5;

/**
 * Atomically claim the next available sync_logs row for a worker.
 * Returns null if nothing is claimable.
 *
 * Concurrency: SELECT … FOR UPDATE SKIP LOCKED — multiple workers can
 * call this simultaneously; whoever loses the race on a row sees null
 * and tries again on the next poll tick.
 *
 * Claimable rows (all require attempt_count < MAX_SYNC_ATTEMPTS):
 *   - status = 'PENDING'
 *   - status = 'FAILED_RETRYABLE' AND nextAttemptAt <= now()
 *
 * On success the row transitions to RUNNING with claimedAt/claimedBy
 * stamped and attemptCount incremented.
 */
export async function tryClaimNext(workerId: string): Promise<SyncLog | null> {
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sync_logs
       WHERE (
               (status = 'PENDING')
               OR (status = 'FAILED_RETRYABLE' AND next_attempt_at <= now())
             )
         AND attempt_count < ${MAX_SYNC_ATTEMPTS}
       ORDER BY started_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    `;
    const id = candidates[0]?.id;
    if (id === undefined) return null;
    return tx.syncLog.update({
      where: { id },
      data: {
        status: 'RUNNING',
        claimedAt: new Date(),
        claimedBy: workerId,
        lastTickAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  });
}
