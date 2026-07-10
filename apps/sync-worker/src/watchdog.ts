import { prisma } from '@pazarsync/db';
import { MAX_SYNC_ATTEMPTS } from '@pazarsync/sync-core';

const STALE_THRESHOLD_SECONDS = 90;

// Terminal reaper message stamped on rows the sweep gives up on. Uses the
// existing INTERNAL_ERROR SyncErrorCode (no new enum value / schema change
// in this PR) so the SyncCenter UI still renders a recognizable failure.
const ATTEMPT_EXHAUSTED_MESSAGE = 'attempt limit exhausted (watchdog reaper)';

/**
 * Sweep the sync_logs queue for rows a live worker can no longer make
 * progress on. Runs from every worker every 30 s — idempotent and safe to
 * overlap. Three disjoint cases, split on attempt_count so no row is
 * touched by more than one branch:
 *
 *   (a) Stale RUNNING (last_tick_at older than the 90 s threshold) AND
 *       attempt_count >= MAX_SYNC_ATTEMPTS. The worker holding this claim
 *       is dead and the row has already burned every attempt, so re-queuing
 *       it would just make it unclaimable forever (tryClaimNext caps at
 *       MAX). Terminate it: status FAILED, error INTERNAL_ERROR + the reaper
 *       message, claim released.
 *
 *   (b) Stale RUNNING with attempt_count < MAX. The classic crashed-worker
 *       case — hand the row back to PENDING so a peer resumes from the saved
 *       cursor. This is the historical watchdog behavior, unchanged.
 *
 *   (c) PENDING or FAILED_RETRYABLE with attempt_count >= MAX. Since the
 *       attempt cap landed on tryClaimNext, these are unclaimable and would
 *       otherwise starve the per-(store, type) slot forever. Same terminal
 *       FAILED treatment as (a).
 *
 * Fresh (non-stale) RUNNING rows with attempt_count == MAX are legitimately
 * executing their final attempt — they match NONE of the branches (case (a)
 * requires staleness; cases (b)/(c) exclude them by status/attempt) and are
 * left alone.
 *
 * The threshold and the attempt cap are passed as parameters so Prisma can
 * serialize them without `$executeRawUnsafe` or string concatenation.
 *
 * Returns the total number of rows reaped (terminal + requeued).
 */
export async function sweepStaleClaims(): Promise<number> {
  const thresholdAt = new Date(Date.now() - STALE_THRESHOLD_SECONDS * 1000);

  // Both statements run in one transaction so a crash mid-sweep never leaves
  // the queue half-swept. Their attempt_count predicates are disjoint
  // (>= MAX vs < MAX), so ordering between them is irrelevant.
  const [terminalCount, requeuedCount] = await prisma.$transaction([
    // (a) stale RUNNING at the cap + (c) unclaimable PENDING/FAILED_RETRYABLE.
    prisma.$executeRaw`
      UPDATE sync_logs SET
        status = 'FAILED',
        completed_at = now(),
        error_code = 'INTERNAL_ERROR',
        error_message = ${ATTEMPT_EXHAUSTED_MESSAGE},
        claimed_at = NULL,
        claimed_by = NULL
      WHERE attempt_count >= ${MAX_SYNC_ATTEMPTS}
        AND (
              (status = 'RUNNING' AND last_tick_at < ${thresholdAt})
              OR status = 'PENDING'
              OR status = 'FAILED_RETRYABLE'
            )
    `,
    // (b) stale RUNNING below the cap → back to PENDING for a peer to resume.
    prisma.$executeRaw`
      UPDATE sync_logs SET
        status = 'PENDING',
        claimed_at = NULL,
        claimed_by = NULL
      WHERE status = 'RUNNING'
        AND last_tick_at < ${thresholdAt}
        AND attempt_count < ${MAX_SYNC_ATTEMPTS}
    `,
  ]);

  return Number(terminalCount) + Number(requeuedCount);
}
