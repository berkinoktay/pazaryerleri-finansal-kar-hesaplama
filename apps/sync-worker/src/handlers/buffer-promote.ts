import { prisma } from '@pazarsync/db';
import type { BufferEntryStatus, LivePerformanceBuffer } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import { buildCalcCheckLines, resolveOrderCalculability } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';
import { getBusinessDateAnchor } from '@pazarsync/utils';

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

        // Calculated-or-excluded bekçisi (spec 2026-06-12): PROMOTING/FAILED
        // damgası maliyetin HÂLÂ yerinde olduğunu garanti etmez — flush-fail'li
        // PENDING entry FAILED üzerinden bu yola düşer, flip sonrası profil
        // arşivlenmiş olabilir. Maliyetsiz bir entry tam-yazım yolundan ASLA
        // geçemez (estimate null + exclusion yok = ölü üçüncü durum doğardı).
        // Kilit altında calculability yeniden çözülür ve yönlendirilir.
        const calcLines = await buildCalcCheckLines(tx, {
          storeId: entry.storeId,
          lines: mapped.lines.map((line) => ({ barcode: line.barcode })),
        });
        if (resolveOrderCalculability(calcLines).kind !== 'calculable') {
          if (entry.orderDate.getTime() < getBusinessDateAnchor(now).getTime()) {
            // Pencere kapalı → flush semantiği: KÂR-DIŞI mezuniyet.
            syncLog.info('buffer.promote-excluded-graduation', {
              entryId: entry.id,
              storeId: entry.storeId,
              platformOrderId: entry.platformOrderId,
            });
            await upsertOrderWithSnapshot(entry.storeId, entry.organizationId, mapped, tx, {
              profitExclusion: { reason: 'COST_DEADLINE_MISSED' },
              promotedFromBuffer: true,
            });
            await tx.livePerformanceBuffer.delete({ where: { id: entry.id } });
            return entry;
          }
          // Aynı gün: pencere hâlâ açık — entry PENDING'e iade edilir; maliyet
          // gün içinde gelirse attach-tetikli flip yeniden PROMOTING'e çeker.
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

        // Same tx → order write + buffer delete commit atomically. Marked as a
        // buffer graduation so the realtime toast suppresses a duplicate ding for
        // an order the seller already saw as a cost-missing buffer entry.
        await upsertOrderWithSnapshot(entry.storeId, entry.organizationId, mapped, tx, {
          promotedFromBuffer: true,
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
 * business date is before today into `orders` as PROFIT-EXCLUDED
 * (COST_DEADLINE_MISSED — spec 2026-06-12), then delete the buffer row —
 * same atomic claim+upsert+delete as promoteOne. Ciro kaydı korunur; kâr
 * alanları kalıcı donuk ("null kârla mezuniyet + sonradan maliyet" kalktı).
 *
 * Pass 1 (PENDING): PROMOTING (cost just attached) and FAILED (retry-due)
 * past-day entries are already handled by processBufferPromote, so this pass
 * owns exactly the orders whose cost never arrived before midnight. A PENDING
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
    await flushOne(id);
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
    const failedId = await flushOne(id);
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
async function flushOne(id: string): Promise<string | null> {
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
      // Pencere kapandı: KÂR-DIŞI mezuniyet (spec 2026-06-12). Ciro kaydı
      // korunur; kâr alanları kalıcı donuk. Aynı tx → order + buffer-delete atomik.
      await upsertOrderWithSnapshot(entry.storeId, entry.organizationId, mapped, tx, {
        profitExclusion: { reason: 'COST_DEADLINE_MISSED' },
        promotedFromBuffer: true,
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
