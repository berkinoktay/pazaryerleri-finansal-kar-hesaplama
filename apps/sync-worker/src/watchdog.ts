import { prisma } from '@pazarsync/db';

const STALE_THRESHOLD_SECONDS = 90;

/**
 * Mark RUNNING rows with stale heartbeats as PENDING so a peer
 * worker (or post-restart self) can reclaim them. Idempotent —
 * safe to run from every worker every 30 s.
 *
 * The threshold is computed in JS and passed as a parameterized
 * timestamp so Prisma can serialize it to `timestamptz` without
 * resorting to `$executeRawUnsafe` or string concatenation.
 *
 * Returns the number of rows reaped.
 */
export async function sweepStaleClaims(): Promise<number> {
  const thresholdAt = new Date(Date.now() - STALE_THRESHOLD_SECONDS * 1000);
  const result = await prisma.$executeRaw`
    UPDATE sync_logs SET
      status = 'PENDING',
      claimed_at = NULL,
      claimed_by = NULL
    WHERE status = 'RUNNING'
      AND last_tick_at < ${thresholdAt}
  `;
  return Number(result);
}
