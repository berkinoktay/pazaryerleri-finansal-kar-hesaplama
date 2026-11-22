import { prisma } from '@pazarsync/db';
import type {
  BufferEntryStatus,
  LivePerformanceBuffer,
  Prisma,
  ProfitExclusionReason,
} from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { hadCostWithinOrderDay, upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import {
  buildCalcCheckLines,
  hasMissingDesi,
  type OrderLineForCalcCheck,
  resolveOrderCalculability,
} from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';
import { getBusinessDateAnchor } from '@pazarsync/utils';

import { isRetryDue, MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES } from '../lib/buffer-promote-backoff';

const CHUNK_SIZE = 25;

/**
 * The SINGLE cost-window + desi decision point every buffer graduation routes through.
 * Berkin 2026-11-03: an order enters net profit only if every non-cancelled item
 * had a cost entered before the order's business day ended; supply prices drift,
 * so a cost entered after that day is too late. Berkin 2026-11-22 (plan PR-2c): every
 * non-digital item also needs an effective desi; the desi is checked for presence at
 * graduation (no entry time is recorded for it), and the cost reason wins when both
 * are missing.
 *
 * This excludes ONLY a PAST-DAY entry whose cost is still missing or arrived late
 * (COST_DEADLINE_MISSED), or whose cost was timely but a product still has no desi
 * (DESI_DEADLINE_MISSED), and returns undefined -- no exclusion -- for:
 *   - a SAME-DAY entry: its cost/desi window is still open, so it is never excluded
 *     here regardless of its cost or desi state. The guard below enforces this so the
 *     function cannot mislead -- it decides PAST-DAY graduations only; the day-end
 *     flush owns an entry once its day closes.
 *   - a CANCELLED order: it carries no payout and is never excluded.
 *
 * The decision reads the attach/version timestamps against the entry's OWN business
 * day end (via hadCostWithinOrderDay), so a cost attached before that end still
 * counts even when this tick runs after midnight. Tenant-scoped via the entry's
 * organization + store. The caller's already-built calc lines are reused (no
 * rebuild) for both the cost timing and the desi check. A buffer snapshot carries no
 * per-line cancel flag, so every line is treated as non-cancelled (the order-level
 * CANCELLED check owns the cancelled case).
 */
async function resolvePastDayGraduationExclusion(
  tx: Prisma.TransactionClient,
  entry: LivePerformanceBuffer,
  mapped: MappedOrder,
  calcLines: readonly OrderLineForCalcCheck[],
  now: Date,
): Promise<{ readonly reason: ProfitExclusionReason } | undefined> {
  // Same-day guard: the cost/desi window has not closed, so a same-day entry is
  // never excluded here. Keeps the name honest (PAST-DAY graduations only).
  if (entry.orderDate.getTime() >= getBusinessDateAnchor(now).getTime()) {
    return undefined;
  }
  if (mapped.status === 'CANCELLED') {
    return undefined;
  }
  const hasTimelyCost = await hadCostWithinOrderDay(tx, {
    organizationId: entry.organizationId,
    storeId: entry.storeId,
    orderDate: entry.orderDate,
    items: calcLines.map((line) => ({ productVariantId: line.variantId, isCancelled: false })),
  });
  if (!hasTimelyCost) {
    return { reason: 'COST_DEADLINE_MISSED' };
  }
  if (hasMissingDesi(calcLines)) {
    return { reason: 'DESI_DEADLINE_MISSED' };
  }
  return undefined;
}

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

        // Calculability re-check under the lock: a PROMOTING/FAILED stamp does not
        // prove the cost and the desi are STILL in place -- a flush-failed PENDING entry
        // falls onto this path through FAILED, the profile may have been archived after
        // the flip, and a product desi may have been emptied. So calculability (cost +
        // desi, plan PR-2c) is re-resolved here and routed: a SAME-DAY entry whose cost
        // or desi is still missing is demoted to PENDING so the day's window can still
        // catch it; every other entry graduates into orders below.
        const calcLines = await buildCalcCheckLines(tx, {
          storeId: entry.storeId,
          lines: mapped.lines.map((line) => ({ barcode: line.barcode })),
        });
        const isCalculable = resolveOrderCalculability(calcLines).kind === 'calculable';
        const windowClosed = entry.orderDate.getTime() < getBusinessDateAnchor(now).getTime();

        if (!isCalculable && !windowClosed) {
          // Same day, cost or desi still missing: the window is still open, so return
          // the entry to PENDING; the missing value arriving during the day re-promotes
          // it via the entry-triggered flip.
          syncLog.warn('buffer.promote-demoted-pending', {
            entryId: entry.id,
            storeId: entry.storeId,
            platformOrderId: entry.platformOrderId,
          });
          await tx.livePerformanceBuffer.update({
            where: { id: entry.id },
            data: { status: 'PENDING' },
          });
          return null;
        }

        // Graduate into orders. ONE cost-window + desi decision point for EVERY
        // graduation (Berkin 2026-11-03, 2026-11-22): resolvePastDayGraduationExclusion
        // excludes a PAST-DAY entry whose cost missed the order's business day
        // (COST_DEADLINE_MISSED) or whose product still has no desi
        // (DESI_DEADLINE_MISSED), and no-ops for a same-day or cancelled entry. So a
        // past-day entry that is calculable ONLY because a late cost was attached is
        // still excluded (the BLOCKER this fixes: the calculable branch used to skip the
        // check), while a same-day calculable promote is not. The already-built calc
        // lines are reused. Same tx -> order write + buffer delete commit atomically;
        // marked as a buffer graduation so the realtime toast suppresses a duplicate ding
        // for an order the seller already saw as a waiting buffer entry. profitExclusion
        // is stamped CREATE-only inside upsertOrderWithSnapshot.
        const profitExclusion = await resolvePastDayGraduationExclusion(
          tx,
          entry,
          mapped,
          calcLines,
          now,
        );
        syncLog.info('buffer.promote-graduation', {
          entryId: entry.id,
          storeId: entry.storeId,
          platformOrderId: entry.platformOrderId,
          excluded: profitExclusion !== undefined,
        });
        await upsertOrderWithSnapshot(entry.storeId, entry.organizationId, mapped, tx, {
          promotedFromBuffer: true,
          profitExclusion,
        });
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

const FLUSH_CHUNK_SIZE = 25;

// PERMANENT_FAILED past-day rows are retried on their OWN small per-tick bound,
// separate from the PENDING chunk, so a backlog of un-graduatable corrupt rows
// can never starve the primary PENDING flush (PENDING is the common case and
// must always drain). The [status, last_failed_at] index serves the WHERE only
// (seek to status='PERMANENT_FAILED'); ordering is by orderDate so the rows
// NEAREST the 7-day reaper get their final graduation attempt first, and a
// late-arriving old-business-date row is retried before it can be reaped. The
// LIMIT caps the per-tick cost; a row that stays corrupt just retries next tick
// until the 7-day reset cron reaps it.
const PERMANENT_FAILED_RETRY_LIMIT = 25;

// Log throttle for renewed PERMANENT_FAILED retry failures. The flush tick runs
// every 5s and a stuck row can persist for up to 7 days, so a per-row error line
// would emit up to ~300/min for a week. Instead we drop the per-row line (the
// logger has no debug level) and emit ONE aggregate summary at most every 15 min.
const PERMANENT_FAILED_RETRY_SUMMARY_THROTTLE_MS = 15 * 60_000;
let lastPermanentFailedRetrySummaryAt = 0;

/**
 * One flush tick: graduate up to FLUSH_CHUNK_SIZE PENDING buffer entries whose
 * business date is before today into `orders`, then delete the buffer row -- same
 * atomic claim+upsert+delete as promoteOne. Cost-window rule (Berkin 2026-11-03):
 * an entry whose cost missed the order's business day graduates PROFIT-EXCLUDED
 * (COST_DEADLINE_MISSED); its ciro still counts, its net profit never shows. Desi
 * rule (Berkin 2026-11-22): an entry costed in time whose product still has no desi
 * graduates PROFIT-EXCLUDED as DESI_DEADLINE_MISSED. An entry costed in time with a
 * desi (or a cancelled one) graduates as a normal order.
 *
 * Pass 1 (PENDING): PROMOTING (cost or desi just entered) and FAILED (retry-due)
 * past-day entries are already handled by processBufferPromote, so this pass
 * owns exactly the orders whose cost or desi never arrived before midnight. A PENDING
 * flush that throws is marked FAILED, handing it to the promote retry path.
 *
 * Pass 2 (PERMANENT_FAILED, loss-proofing 2026-07-11): a row that exhausted its
 * promote attempts gets a final graduation attempt here BEFORE the 7-day reset
 * cron may delete it, so an order that becomes graduatable lands in `orders`
 * instead of vanishing. A PERMANENT_FAILED flush that throws leaves the row
 * untouched (no status demotion, no attempts churn); only the reset cron removes
 * it, and only after the 7-day recovery window. Renewed failures are NOT logged
 * per row (that would flood the log for a week) — the tick aggregates them into
 * a single throttled 'buffer.permanent-failed-retry-summary'.
 */
export async function processPastDayBufferFlush(now: Date = new Date()): Promise<void> {
  const todayAnchor = getBusinessDateAnchor(now);

  const pending = await prisma.livePerformanceBuffer.findMany({
    where: { status: 'PENDING', orderDate: { lt: todayAnchor } },
    orderBy: { createdAt: 'asc' },
    take: FLUSH_CHUNK_SIZE,
    select: { id: true },
  });
  for (const { id } of pending) {
    await flushOne(id, now);
  }

  // Pass 2: give past-day PERMANENT_FAILED rows a final graduation attempt via
  // the same flushOne path, bounded by its own LIMIT so it can never starve the
  // PENDING pass above. Ordered by orderDate so the rows closest to the 7-day
  // reaper are retried first. Collect the ids whose retry failed AGAIN this tick
  // so we can emit one throttled aggregate instead of a per-row error flood.
  const permanentFailed = await prisma.livePerformanceBuffer.findMany({
    where: { status: 'PERMANENT_FAILED', orderDate: { lt: todayAnchor } },
    orderBy: { orderDate: 'asc' },
    take: PERMANENT_FAILED_RETRY_LIMIT,
    select: { id: true },
  });
  const retryFailedIds: string[] = [];
  for (const { id } of permanentFailed) {
    const failedId = await flushOne(id, now);
    if (failedId !== null) {
      retryFailedIds.push(failedId);
    }
  }

  // Throttled aggregate: at most one summary every 15 min, only when this tick
  // saw at least one renewed PERMANENT_FAILED failure.
  if (retryFailedIds.length > 0) {
    const nowMs = now.getTime();
    if (nowMs - lastPermanentFailedRetrySummaryAt >= PERMANENT_FAILED_RETRY_SUMMARY_THROTTLE_MS) {
      syncLog.error('buffer.permanent-failed-retry-summary', {
        failedCount: retryFailedIds.length,
        sampleEntryIds: retryFailedIds.slice(0, 5),
      });
      lastPermanentFailedRetrySummaryAt = nowMs;
    }
  }
}

/**
 * Graduate one buffer row (PENDING or past-day PERMANENT_FAILED). Returns the
 * entry id when a PERMANENT_FAILED retry failed AGAIN this call (so the caller
 * can aggregate + throttle the log); returns null in every other outcome
 * (success, skip, claim-lost, or a PENDING failure that was marked FAILED).
 */
async function flushOne(id: string, now: Date): Promise<string | null> {
  try {
    const flushed = await prisma.$transaction(async (tx): Promise<LivePerformanceBuffer | null> => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM live_performance_buffer WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED
        `;
      if (locked.length === 0) {
        return null;
      }

      const entry = await tx.livePerformanceBuffer.findUniqueOrThrow({ where: { id } });

      // Re-check STATUS under the lock — cost may have been attached since the
      // unlocked prefilter (PENDING → PROMOTING), in which case the promote tick
      // owns the entry. order_date is immutable and the candidate query already
      // filtered `order_date < todayAnchor`, so there is no date re-check here
      // (avoids any @db.Date-vs-DateTime comparison ambiguity).
      // Loss-proofing (2026-07-11): flush also owns PERMANENT_FAILED past-day
      // rows for a final graduation attempt. A PENDING row may have flipped to
      // PROMOTING since the unlocked prefilter (cost attached), which belongs to
      // the promote tick, so only PENDING or PERMANENT_FAILED graduate here.
      if (entry.status !== 'PENDING' && entry.status !== 'PERMANENT_FAILED') {
        return null;
      }

      const mapped = entry.mappedOrder as unknown as MappedOrder;
      // Window closed: graduate into orders. Cost-window rule (Berkin 2026-11-03): a
      // past-day entry whose cost missed the order's business day is excluded with
      // COST_DEADLINE_MISSED; one costed in time whose product still has no desi is
      // excluded with DESI_DEADLINE_MISSED (Berkin 2026-11-22). A cancelled entry (or
      // one costed in time with a desi -- e.g. a cost attached just before midnight
      // while the attach-flip had not yet fired) graduates as a normal order. The flush
      // path graduates unconditionally (no calculability re-check), so the calc lines
      // are built here solely to feed the single cost-window + desi decision point. Same
      // tx -> order write + buffer delete commit atomically. profitExclusion is stamped
      // CREATE-only inside upsertOrderWithSnapshot.
      const calcLines = await buildCalcCheckLines(tx, {
        storeId: entry.storeId,
        lines: mapped.lines.map((line) => ({ barcode: line.barcode })),
      });
      const profitExclusion = await resolvePastDayGraduationExclusion(
        tx,
        entry,
        mapped,
        calcLines,
        now,
      );
      await upsertOrderWithSnapshot(entry.storeId, entry.organizationId, mapped, tx, {
        promotedFromBuffer: true,
        profitExclusion,
      });
      await tx.livePerformanceBuffer.delete({ where: { id: entry.id } });
      return entry;
    });

    if (flushed !== null) {
      syncLog.info('buffer.flush-graduated', {
        entryId: flushed.id,
        storeId: flushed.storeId,
        platformOrderId: flushed.platformOrderId,
        orderDate: flushed.orderDate.toISOString(),
      });
    }
    return null;
  } catch (err) {
    // Graduation tx rolled back; the row is unchanged.
    const entry = await prisma.livePerformanceBuffer.findUnique({ where: { id } });
    if (entry === null) {
      syncLog.error('buffer.flush-claim-failed', {
        entryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (entry.status === 'PERMANENT_FAILED') {
      // Loss-proofing: a PERMANENT_FAILED flush retry that fails again leaves the
      // row exactly as it was (no status demotion, no attempts churn). Only the
      // 7-day reset cron may ever remove it, and only after the recovery window.
      // Do NOT log per row here — a stuck row would emit an error every 5s tick
      // for up to 7 days. Signal the id to the caller, which folds all of this
      // tick's renewed failures into one throttled summary.
      return entry.id;
    }
    // PENDING graduation failed: mark FAILED so the promote retry path (and
    // eventually PERMANENT_FAILED) takes over. Reuses the promote backoff.
    await markFailed(entry, err);
    return null;
  }
}
