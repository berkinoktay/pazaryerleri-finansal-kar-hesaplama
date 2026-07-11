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
 *   - status = 'FAILED_RETRYABLE' AND next_attempt_at <= now()
 *   - AND started_at <= now() — see the earliest-run note below
 *
 * Ordering: ORDER BY COALESCE(next_attempt_at, started_at) — a row's
 * priority is when it became READY, not when it was first enqueued (see
 * the fair-ordering note below).
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
         -- Earliest-run gate: started_at doubles as an earliest-run time so a
         -- fan-out can stagger its enqueues into the future (see the daily
         -- products cron) and this scan naturally spreads them out instead of
         -- hammering every store at the same instant. Existing callers all set
         -- started_at <= now() (bootstrap uses base+index ms in the past,
         -- acquireSlot uses now()), so this gate is a no-op for them.
         AND started_at <= now()
       -- Fair ordering: a retry's priority is when its backoff elapsed
       -- (next_attempt_at), not its original enqueue time. Ordering by
       -- started_at alone let an old FAILED_RETRYABLE row (ancient started_at)
       -- permanently outrank fresh PENDING work. COALESCE falls back to
       -- started_at for PENDING rows (next_attempt_at is null there), so plain
       -- FIFO among PENDING work is preserved.
       ORDER BY COALESCE(next_attempt_at, started_at)
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
