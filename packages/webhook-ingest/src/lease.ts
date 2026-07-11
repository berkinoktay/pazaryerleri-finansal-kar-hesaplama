/**
 * Webhook-event lease/claim primitives — the single structural gate that makes
 * concurrent double-processing of one `webhook_events` row impossible.
 *
 * Why a lease (design 2026-07-11 Paket D, section D3; discovery fact #1):
 * replaying an unprocessed webhook event SEQUENTIALLY is safe end to end (the
 * watermark skips a strictly-older delivery, order items are insert-skip-if-
 * exists, the buffer dedupes via a P2002 tx-abort, settled values are guarded,
 * and PSF/Stopaj estimate fees are skip-if-exists). What is NOT safe is two
 * writers processing the SAME row AT THE SAME TIME: under Read Committed they
 * can both insert `order_items` (there is no DB unique there) and both decrement
 * stock. So every processor — the receiver route AND the sync-worker consumer
 * tick — must first WIN a conditional-UPDATE lease before touching the row. Two
 * callers racing the same `WHERE processed_at IS NULL AND next_process_at <=
 * now()` predicate can never both come back with rowCount 1.
 *
 * SCOPE OF THE GUARANTEE (be honest about it): the lease closes the SIMULTANEOUS
 * cross-writer race, but only while a claim's work finishes INSIDE the lease
 * window. The lease is NOT renewed mid-work, so if processing outran the lease,
 * the row would become re-claimable while still in flight and an overlapping
 * writer could double-process it. Callers must therefore keep their per-row work
 * safely under the lease — the sync-worker consumer runs catalog repair
 * 'deferred' (DB-only, milliseconds) for exactly this reason. Same-process
 * overlap is closed separately by the caller's `tickInFlight` guard, not here. A
 * genuine MULTI-INSTANCE deployment (two processes overlapping AND a claim
 * outrunning its lease) is out of scope: move to a renewed lease or a
 * `SELECT ... FOR UPDATE SKIP LOCKED` claim before scaling past one worker
 * instance (the variant-resolution tick keeps the same honest single-instance
 * stance).
 *
 * Why NOT a `SELECT ... FOR UPDATE` row lock: `intakeOrder` opens its OWN
 * `$transaction` on a separate connection, so a lock held here would not cover
 * the intake writes anyway. The lease is a time-boxed claim instead — a row
 * whose holder dies mid-work becomes re-claimable once the lease elapses, and
 * replaying it is safe (see the sequential-replay fact above).
 */
import type { PrismaClient } from '@pazarsync/db';

/**
 * Lease duration. A processor that wins a fresh claim has this long to finish
 * before the row becomes re-claimable by a scanner. Sized well above a normal
 * intake so a healthy run never races itself; a crash mid-intake simply replays
 * once the deadline passes.
 */
export const WEBHOOK_EVENT_LEASE_MS = 120_000;

/** Give up after this many lease attempts — the MAX-th failure is terminal. */
export const MAX_PROCESS_ATTEMPTS = 5;

/**
 * Backoff before the next retry, indexed by the (1-based) attempt that just
 * failed transiently: the attempt numbered n waits PROCESS_BACKOFF_MINUTES[n-1]
 * minutes. Four entries cover attempts 1-4; a 5th failure is terminal (no
 * further wait — the row is stamped closed).
 */
export const PROCESS_BACKOFF_MINUTES = [1, 5, 15, 60] as const;

const MS_PER_MINUTE = 60_000;

/** `processing_error` is a free-text audit column — cap it (buffer-promote emsali). */
const MAX_PROCESSING_ERROR_LENGTH = 1000;

/**
 * Try to claim the processing lease on one webhook event. A single conditional
 * UPDATE bumps the attempt counter and pushes `next_process_at` a lease-length
 * into the future, but ONLY for a row that is still unprocessed AND currently
 * eligible (`next_process_at` is null or already due). Returns true when exactly
 * one row was updated (this caller owns the lease), false when another processor
 * already holds it or the row is already closed.
 *
 * DB `now()` — not the application clock — drives BOTH the eligibility predicate
 * and the new deadline, so every processor races against one authoritative
 * clock. The event id is bound as a parameter (`::uuid` cast); the lease length
 * is bound too — no string interpolation.
 */
export async function claimWebhookEventLease(
  db: PrismaClient,
  webhookEventId: string,
): Promise<boolean> {
  const affected = await db.$executeRaw`
    UPDATE webhook_events
    SET process_attempts = process_attempts + 1,
        next_process_at = now() + (${WEBHOOK_EVENT_LEASE_MS} || ' milliseconds')::interval
    WHERE id = ${webhookEventId}::uuid
      AND processed_at IS NULL
      AND (next_process_at IS NULL OR next_process_at <= now())
  `;
  return affected === 1;
}

/**
 * Record a TRANSIENT processing failure on a row this caller currently holds the
 * lease for. The lease makes us the sole writer AS LONG AS this work finished
 * inside the lease window (see the scope note in the module header — the lease is
 * not renewed mid-work), which holds for the DB-only 'deferred' consumer path.
 * Given that, a read-then-write is safe: `claimWebhookEventLease` already
 * incremented `process_attempts`, so we read that count back and branch on it.
 *   - attempts >= MAX_PROCESS_ATTEMPTS -> terminal: stamp `processedAt` (which
 *     drops the row from the unprocessed partial index) plus an "exhausted"
 *     `processingError`. This is the buffer-promote PERMANENT_FAILED pattern
 *     translated into the webhook_events vocabulary (processedAt = closed).
 *   - otherwise -> schedule a retry: keep `processedAt` null and push
 *     `nextProcessAt` out by the current attempt's backoff so a scanner skips
 *     the row until the window elapses.
 *
 * The error message is truncated to a bounded length before it is stored.
 */
export async function recordTransientProcessingFailure(
  db: PrismaClient,
  webhookEventId: string,
  error: unknown,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_PROCESSING_ERROR_LENGTH,
  );

  const row = await db.webhookEvent.findUnique({
    where: { id: webhookEventId },
    select: { processAttempts: true },
  });
  if (row === null) {
    // The row vanished between the lease and this write (retention prune or a
    // cascade delete). Nothing left to record — treat as handled.
    return;
  }

  const attempts = row.processAttempts;
  if (attempts >= MAX_PROCESS_ATTEMPTS) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processedAt: new Date(),
        processingError: `attempt limit exhausted (webhook ingest): ${message}`,
      },
    });
    return;
  }

  const backoffMinutes = PROCESS_BACKOFF_MINUTES[attempts - 1] ?? PROCESS_BACKOFF_MINUTES[0];
  await db.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      processingError: message,
      nextProcessAt: new Date(Date.now() + backoffMinutes * MS_PER_MINUTE),
    },
  });
}
