/**
 * Shared order-intake routing — the single decision point used by BOTH the
 * webhook receiver (apps/api) and the polling sync-worker (apps/sync-worker)
 * so the two ingest paths behave identically (Slice 0, Decision 1A).
 *
 * Routing (see the spec's decision table + split research 2026-06-09 +
 * cost-deadline-profit-freeze spec 2026-06-12):
 *   - dematerialized (UnPacked)    → DELETE order + buffer rows (split ghost — children re-carry content)
 *   - status CANCELLED             → purge buffer rows + upsert (audit row; aggregates exclude by status)
 *   - variant_not_found            → cost_missing route (order IS written; line keeps barcode, null variant FK; resolution in PR-2)
 *   - calculable                   → upsertOrderWithSnapshot (full profit)
 *   - cost_missing + past-day      → KÂR-DIŞI yazım (LATE_UNCOSTED_ARRIVAL; ciro kalır, kâr donuk — spec 2026-06-12)
 *   - cost_missing + today + in orders → upsertOrderWithSnapshot (idempotent, no buffer)
 *   - cost_missing + today + new   → live_performance_buffer (PENDING, same-day cost-flip window)
 *
 * The "already in orders" guard prevents a phantom buffer row for an order that
 * was costed earlier then had its cost profile archived (would otherwise live in
 * BOTH orders and buffer → double-count on the Live Performance page).
 *
 * Calculated-or-excluded (spec 2026-06-12 §3): orders'a giren her sipariş ya
 * HESAPLANMIŞ (estimatedNetProfit dolu) ya KÂR-DIŞI (profitExcludedAt dolu)
 * biter. Eski "null kârla yaz, maliyeti sonra gir" üçüncü durumu kalktı — tek
 * maliyet penceresi sipariş gününün sonudur (buffer), kaçıran sipariş kalıcı
 * olarak kâr evreninin dışında kalır.
 */

import { prisma } from '@pazarsync/db';
import { Prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { buildCalcCheckLines, resolveOrderCalculability } from '@pazarsync/profit';
import { getBusinessDate, getBusinessDateAnchor } from '@pazarsync/utils';

import { upsertOrderWithSnapshot } from './upsert-order';

export type OrderIntakeOutcome =
  | {
      kind: 'persisted';
      reason: 'calculable' | 'excluded_late_arrival' | 'already_in_orders' | 'cancelled_audit';
    }
  | { kind: 'buffered' }
  // `refreshed` is an OPTIONAL flag (never a new kind) on purpose: consumers with
  // an exhaustive `switch (outcome.kind)` keep compiling untouched, while callers
  // that care can tell a plain dedupe from one that refreshed the buffer snapshot.
  | { kind: 'buffered_deduped'; refreshed?: boolean }
  | { kind: 'dematerialized'; deletedOrder: boolean; deletedBufferEntries: number };

export async function intakeOrder(args: {
  storeId: string;
  organizationId: string;
  mapped: MappedOrder;
  /**
   * Original vendor payload for the buffer's `raw_payload` (required column).
   * The webhook passes the Trendyol payload; the sync-worker has only the mapped
   * DTO, so when omitted the mapped order doubles as the raw snapshot.
   */
  rawPayload?: Prisma.InputJsonValue;
}): Promise<OrderIntakeOutcome> {
  const { storeId, organizationId, mapped } = args;

  // ─── Split artifact: UnPacked package dematerialized ─────────────────────
  // Trendyol keeps the pre-split package in the feed with status `UnPacked`
  // while `createdBy="split"` children re-carry its full content under new
  // shipmentPackageIds (research 2026-06-09). Persisting the ghost counts the
  // revenue twice (ghost + children), so the ghost is REMOVED from both books.
  // Hard delete matches the project convention (no soft delete); the
  // WebhookEvent / SyncLog rows keep the audit trail.
  if (mapped.dematerialized) {
    const [orderDel, bufferDel] = await prisma.$transaction([
      prisma.order.deleteMany({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
      }),
      prisma.livePerformanceBuffer.deleteMany({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
      }),
    ]);
    return {
      kind: 'dematerialized',
      deletedOrder: orderDel.count > 0,
      deletedBufferEntries: bufferDel.count,
    };
  }

  // ─── Real cancels: purge buffer, persist as audit row ────────────────────
  // A cancelled order produces no payout, so it must never sit in the Live
  // Performance buffer counting volume until the midnight reset. Persist the
  // order itself (audit + ledger visibility); revenue aggregates exclude
  // status=CANCELLED at the query layer.
  if (mapped.status === 'CANCELLED') {
    await prisma.livePerformanceBuffer.deleteMany({
      where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    });
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'cancelled_audit' };
  }

  const calcLines = await buildCalcCheckLines(prisma, { storeId, lines: mapped.lines });
  const calc = resolveOrderCalculability(calcLines);

  // Fully costable → persist with profit.
  if (calc.kind === 'calculable') {
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'calculable' };
  }

  // calc is { kind: 'skip', reason: 'cost_missing', ... } from here.
  // Geçmiş-gün maliyetsiz sipariş: pencere (sipariş gününün sonu) çoktan
  // kapandı → KÂR-DIŞI yazılır (spec 2026-06-12 K3). Ciro kayıtlı kalır,
  // kâr alanları kalıcı donuk — "null kâr + sonradan maliyet" akışı kalktı.
  if (getBusinessDate(mapped.orderDate) < getBusinessDate()) {
    await upsertOrderWithSnapshot(storeId, organizationId, mapped, undefined, {
      profitExclusion: { reason: 'LATE_UNCOSTED_ARRIVAL' },
    });
    return { kind: 'persisted', reason: 'excluded_late_arrival' };
  }

  // Today's cost-missing — but if it is already in orders, persist (idempotent),
  // never create a parallel buffer row (double-count guard). Org-scoped query
  // (CLAUDE.md: every order read filters by organizationId — defense-in-depth).
  const existing = await prisma.order.findFirst({
    where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    select: { id: true },
  });
  if (existing !== null) {
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'already_in_orders' };
  }

  // Today's cost-missing, new → buffer (PENDING). Idempotent on (storeId,
  // platformOrderId): a re-delivery hits the composite unique → P2002 → dedupe.
  try {
    await prisma.livePerformanceBuffer.create({
      data: {
        organizationId,
        storeId,
        orderDate: getBusinessDateAnchor(mapped.orderDate),
        platformOrderId: mapped.platformOrderId,
        platformOrderNumber: mapped.platformOrderNumber,
        rawPayload: args.rawPayload ?? (mapped as unknown as Prisma.InputJsonValue),
        mappedOrder: mapped as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });
    return { kind: 'buffered' };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return refreshBufferSnapshot(args);
    }
    throw err;
  }
}

/**
 * P2002 on the buffer create means a row for this (storeId, platformOrderId)
 * already exists — a concurrent or repeated delivery lost the insert race. Rather
 * than a blind dedupe, refresh the existing PENDING row's snapshot when THIS event
 * is newer, so the eventual promote writes the latest status/fields (an earlier
 * blind dedupe would freeze the buffer at the first event and lose every later
 * status change until the midnight reset).
 *
 * Only PENDING rows are touched: a row already PROMOTING (or later) is being
 * consumed by the promote worker and must not be rewritten under it. The final
 * write is a status-guarded `updateMany` so a row that flipped to PROMOTING
 * between the read and the write is left untouched (count 0 → not refreshed).
 *
 * Concurrency: two concurrent PENDING refreshes are last-write-wins (no row lock
 * on this path); the status predicate only guards the PROMOTING flip. Any stale
 * snapshot that wins the race is corrected by the order-row out-of-order guard
 * once the entry is promoted.
 */
async function refreshBufferSnapshot(args: {
  storeId: string;
  mapped: MappedOrder;
  rawPayload?: Prisma.InputJsonValue;
}): Promise<OrderIntakeOutcome> {
  const { storeId, mapped } = args;

  const existing = await prisma.livePerformanceBuffer.findUnique({
    where: { storeId_platformOrderId: { storeId, platformOrderId: mapped.platformOrderId } },
    select: { id: true, status: true, mappedOrder: true },
  });

  // Race: the promote worker may have deleted the row between the failed create
  // and this read — nothing to refresh.
  if (existing === null || existing.status !== 'PENDING') {
    return { kind: 'buffered_deduped' };
  }

  // Refresh when the buffered snapshot has no comparable timestamp (legacy JSONB)
  // or the incoming event is strictly newer. Equal/older events change nothing.
  // `mapped.lastModifiedDate` is re-wrapped + NaN-checked so a future caller that
  // replays a JSONB snapshot (string / Invalid Date) cannot throw at `.getTime()`;
  // an unparseable incoming value carries no fresher info → do not refresh.
  const existingLmd = parseBufferLastModified(existing.mappedOrder);
  const incomingLmd = mapped.lastModifiedDate != null ? new Date(mapped.lastModifiedDate) : null;
  const shouldRefresh =
    incomingLmd !== null &&
    !Number.isNaN(incomingLmd.getTime()) &&
    (existingLmd === null || incomingLmd.getTime() > existingLmd.getTime());
  if (!shouldRefresh) {
    return { kind: 'buffered_deduped' };
  }

  // orderDate + status are intentionally left untouched — only the mapped/raw
  // snapshot is replaced. Status-guarded so a concurrent flip to PROMOTING wins.
  const updated = await prisma.livePerformanceBuffer.updateMany({
    where: { id: existing.id, status: 'PENDING' },
    data: {
      mappedOrder: mapped as unknown as Prisma.InputJsonValue,
      rawPayload: args.rawPayload ?? (mapped as unknown as Prisma.InputJsonValue),
    },
  });

  return updated.count > 0
    ? { kind: 'buffered_deduped', refreshed: true }
    : { kind: 'buffered_deduped' };
}

/**
 * Defensively read `lastModifiedDate` out of a buffer row's `mappedOrder` JSONB.
 * The value is an ISO string on fresh rows and absent on legacy rows; anything
 * that is not a parseable string/number yields null so the caller treats the row
 * as "older than anything" (always refreshable).
 */
function parseBufferLastModified(mappedOrder: Prisma.JsonValue): Date | null {
  if (typeof mappedOrder !== 'object' || mappedOrder === null || Array.isArray(mappedOrder)) {
    return null;
  }
  const raw = mappedOrder['lastModifiedDate'];
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
