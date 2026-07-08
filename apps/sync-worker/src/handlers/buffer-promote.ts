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

/**
 * One flush tick: graduate up to FLUSH_CHUNK_SIZE PENDING buffer entries whose
 * business date is before today into `orders` as PROFIT-EXCLUDED
 * (COST_DEADLINE_MISSED — spec 2026-06-12), then delete the buffer row —
 * same atomic claim+upsert+delete as promoteOne. Ciro kaydı korunur; kâr
 * alanları kalıcı donuk ("null kârla mezuniyet + sonradan maliyet" kalktı).
 *
 * Scope is PENDING-only by design: PROMOTING (cost just attached) and FAILED
 * (retry-due) past-day entries are already handled by processBufferPromote, so
 * flush owns exactly the orders whose cost never arrived before midnight. A
 * flush that throws marks the entry FAILED, handing it to the promote retry
 * path (and ultimately PERMANENT_FAILED, which the narrowed reset cron cleans
 * up).
 */
export async function processPastDayBufferFlush(now: Date = new Date()): Promise<void> {
  const todayAnchor = getBusinessDateAnchor(now);

  const candidates = await prisma.livePerformanceBuffer.findMany({
    where: { status: 'PENDING', orderDate: { lt: todayAnchor } },
    orderBy: { createdAt: 'asc' },
    take: FLUSH_CHUNK_SIZE,
    select: { id: true },
  });

  for (const { id } of candidates) {
    await flushOne(id);
  }
}

async function flushOne(id: string): Promise<void> {
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
      if (entry.status !== 'PENDING') {
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
  } catch (err) {
    // Graduation tx rolled back; record the failure so the promote retry path
    // (and eventually PERMANENT_FAILED) takes over. Reuses the promote backoff.
    const entry = await prisma.livePerformanceBuffer.findUnique({ where: { id } });
    if (entry !== null) {
      await markFailed(entry, err);
    } else {
      syncLog.error('buffer.flush-claim-failed', {
        entryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
