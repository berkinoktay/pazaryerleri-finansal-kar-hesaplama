import { prisma } from '@pazarsync/db';
import type { BufferEntryStatus, LivePerformanceBuffer } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import { syncLog } from '@pazarsync/sync-core';

import { isRetryDue, MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES } from '../lib/buffer-promote-backoff';

const CHUNK_SIZE = 25;

/**
 * One promote tick: drain up to CHUNK_SIZE due buffer entries into `orders`.
 *
 * "Due" =
 *   - status PROMOTING (cost just attached by the cost-attach service, PR-D), or
 *   - status FAILED whose per-attempt backoff has elapsed and attempts <=
 *     MAX_ATTEMPTS (so a 3rd-attempt entry still gets its final retry).
 *
 * Each entry is claimed + promoted in its OWN transaction guarded by
 * `SELECT … FOR UPDATE SKIP LOCKED`: the lock window is one row wide and
 * parallel worker instances never promote the same entry twice. The order
 * write and the buffer-row delete share that transaction (via the optional
 * `tx` on upsertOrderWithSnapshot), so a promoted order is never left as a
 * lingering buffer placeholder — no transient double-count on the Live
 * Performance page.
 */
export async function processBufferPromote(): Promise<void> {
  const now = new Date();
  // Permissive prefilter using the shortest backoff window; promoteOne re-checks
  // the exact per-attempt backoff under the row lock.
  const earliestEligibleFailedAt = new Date(now.getTime() - RETRY_BACKOFF_MINUTES[0] * 60_000);

  const candidates = await prisma.livePerformanceBuffer.findMany({
    where: {
      OR: [
        { status: 'PROMOTING' },
        {
          status: 'FAILED',
          attempts: { lte: MAX_ATTEMPTS },
          lastFailedAt: { lte: earliestEligibleFailedAt },
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: CHUNK_SIZE,
    select: { id: true },
  });

  for (const { id } of candidates) {
    await promoteOne(id, now);
  }
}

async function promoteOne(id: string, now: Date): Promise<void> {
  try {
    // Returns the promoted entry on success, or null when the row was claimed by
    // a parallel worker or is no longer eligible. On a promote error the tx
    // throws and rolls back — handled in catch.
    const promoted = await prisma.$transaction(
      async (tx): Promise<LivePerformanceBuffer | null> => {
        // Lock the row; SKIP LOCKED → a parallel worker already holds it → skip.
        // Raw query is lock-only (returns id); the mapped row is read via Prisma
        // so camelCase field access is correct ($queryRaw yields snake_case columns).
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM live_performance_buffer WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED
        `;
        if (locked.length === 0) {
          return null;
        }

        const entry = await tx.livePerformanceBuffer.findUniqueOrThrow({ where: { id } });

        // Re-check eligibility under the lock — status / backoff may have changed
        // since the unlocked prefilter read.
        const eligible =
          entry.status === 'PROMOTING' ||
          (entry.status === 'FAILED' &&
            entry.attempts <= MAX_ATTEMPTS &&
            entry.lastFailedAt !== null &&
            isRetryDue({ attempts: entry.attempts, lastFailedAt: entry.lastFailedAt, now }));
        if (!eligible) {
          return null;
        }

        const mapped = entry.mappedOrder as unknown as MappedOrder;
        // Same tx → order write + buffer delete commit atomically.
        await upsertOrderWithSnapshot(entry.storeId, entry.organizationId, mapped, tx);
        await tx.livePerformanceBuffer.delete({ where: { id: entry.id } });
        return entry;
      },
    );

    if (promoted !== null) {
      syncLog.info('buffer.promote-success', {
        entryId: promoted.id,
        storeId: promoted.storeId,
        platformOrderId: promoted.platformOrderId,
      });
    }
  } catch (err) {
    // The promote tx rolled back; the row is unchanged. Re-read it to record the
    // failure (attempts++, FAILED → PERMANENT_FAILED on the 4th).
    const entry = await prisma.livePerformanceBuffer.findUnique({ where: { id } });
    if (entry !== null) {
      await markFailed(entry, err);
    } else {
      syncLog.error('buffer.promote-claim-failed', {
        entryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function markFailed(entry: LivePerformanceBuffer, err: unknown): Promise<void> {
  const nextAttempts = entry.attempts + 1;
  // attempts 1/2/3 → FAILED (retry after 5/15/45 min); the 4th failure is terminal.
  const isPermanent = nextAttempts > MAX_ATTEMPTS;
  const nextStatus: BufferEntryStatus = isPermanent ? 'PERMANENT_FAILED' : 'FAILED';
  const message = err instanceof Error ? err.message : String(err);

  await prisma.livePerformanceBuffer.update({
    where: { id: entry.id },
    data: {
      status: nextStatus,
      attempts: nextAttempts,
      lastError: message.slice(0, 1000),
      lastFailedAt: new Date(),
    },
  });

  const fields = {
    entryId: entry.id,
    storeId: entry.storeId,
    platformOrderId: entry.platformOrderId,
    attempt: nextAttempts,
    error: message,
  };
  if (isPermanent) {
    // No Sentry in the sync-worker yet; when wired, capture here with `fields`.
    syncLog.error('buffer.promote-permanent-failed', fields);
  } else {
    syncLog.warn('buffer.promote-failed', fields);
  }
}
