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
 *   - calculable + today           -> persist + graduate any buffer row (queue recompute)
 *   - past-day + timely cost       -> persist + graduate any buffer row (the queued recompute profits it)
 *   - past-day + cost missed day   -> persist + graduate any buffer row; the permanent
 *                                      exclusion reason is derived from the graduation
 *                                      (buffer row removed -> COST_DEADLINE_MISSED, else
 *                                      LATE_UNCOSTED_ARRIVAL)
 *   - cost_missing + today + in orders -> persist + graduate any buffer row (idempotent)
 *   - cost_missing + today + new   → live_performance_buffer (PENDING, same-day cost-flip window)
 *
 * The "already in orders" guard prevents a phantom buffer row for an order that
 * was costed earlier then had its cost profile archived (would otherwise live in
 * BOTH orders and buffer → double-count on the Live Performance page).
 *
 * Buffer graduation on persist (Faz 4A, Gorev 8): a cost-missing order parks in the
 * buffer and drops its stock there; once its cost is attached (cost-attach service) or
 * its variant resolves (variant-resolution tick) it becomes calculable, and the NEXT
 * delivery -- a status webhook or the periodic ORDERS sync -- reaches a persist branch
 * below. Each such branch persists through `persistWithBufferGraduation`, which deletes
 * any buffer row for the same (organizationId, storeId, platformOrderId) in the SAME
 * transaction as the order write. Without this the order would sit in BOTH `orders` and
 * the buffer until the promote tick / midnight flush, and getKpis -- which unions orders
 * with today's buffer -- would count its revenue, units and order twice. A graduated
 * write is flagged promotedFromBuffer so the buffer's intake decrement is not repeated
 * (exactly what the buffer-promote worker does).
 *
 * Cost-window rule (Berkin 2026-11-03): an order enters net profit only if every
 * non-cancelled item had a cost entered BEFORE the order's business day ended
 * (Europe/Istanbul midnight). Supply prices drift, so a cost entered after that day
 * may not reflect the day's real price. A past-day order that arrives without a
 * timely cost -- or one whose cost was entered only after its day (hadCostWithinOrderDay
 * false) -- is persisted but PERMANENTLY excluded from profit; its ciro still counts, its
 * net profit never shows. The exclusion reason is derived from whether a live-performance
 * buffer row for the same order is graduated in the persisting transaction: a coexisting
 * buffer row proves the order ARRIVED within its business day (the buffer only holds
 * same-day cost-missing orders) and merely missed its cost deadline -> COST_DEADLINE_MISSED
 * (the same reason the day-end flush stamps); with no buffer row we first saw the order
 * after its day had closed -> LATE_UNCOSTED_ARRIVAL. Only a missing COST excludes; a
 * missing desi / commission / carrier never does, and a cancelled order is never
 * excluded (its CANCELLED branch returns above). The order is still enqueued for a
 * profit recompute like every other write. This supersedes the phase-3B "no
 * auto-exclusion" stance. The live-performance buffer still owns the same-day
 * cost-flip window for today's orders.
 */

import { refreshProductAggregates } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import { Prisma } from '@pazarsync/db';
import { ProfitExclusionReason } from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import { buildCalcCheckLines, resolveOrderCalculability } from '@pazarsync/profit';
import { getBusinessDate, getBusinessDateAnchor } from '@pazarsync/utils';

import { hadCostWithinOrderDay } from './cost-window';
import { decrementVariantStock, incrementVariantStock, isOrderOnBusinessToday } from './stock';
import { upsertOrderWithSnapshot } from './upsert-order';

export type OrderIntakeOutcome =
  | {
      kind: 'persisted';
      reason: 'calculable' | 'late_uncosted_arrival' | 'already_in_orders' | 'cancelled_audit';
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
    // Reverse the optimistic stock decrement before deleting the ghost. The
    // pre-split package may have decremented local variant stock either as a
    // persisted ORDER (direct-calculable first insert) or as a BUFFER row
    // (cost-missing-today intake — owner ruling 2026-07-11). The split children
    // re-carry that same content under NEW shipmentPackageIds and will decrement
    // again as fresh lines, so re-adding the ghost's line quantities here nets the
    // two out — otherwise the same units would be subtracted twice. This is the
    // ONLY place the optimistic decrement is undone; every other cancel / return
    // leaves it for the catalog scan to reconcile. Owner-approved 2026-07-11.
    // Interactive transaction so the re-add + recompute + deletes commit atomically.
    //
    // Reversal source is EXCLUSIVE — the order row OR the buffer rows, never both.
    // Invariant: an order row and a buffer row do NOT coexist for one
    // (org, store, platformOrderId). The buffered path only inserts a buffer row
    // when no order exists (the routing persists calculable / already-in-orders /
    // past-day BEFORE reaching the buffer branch), and every persist branch (plus
    // the buffer-promote worker) deletes any coexisting buffer row atomically with
    // the order write (Faz 4A, Gorev 8). So exactly one source owns
    // the single decrement; re-adding from just that source both undoes the
    // decrement and guarantees no variant is double-credited even in a rare
    // cross-path race — preferring the order row when present.
    //
    // Symmetry with the decrement gate: the decrement fires only for an order
    // whose business date is TODAY, so the reversal re-adds ONLY when the source's
    // own business date is today. A past-day (backfilled / bootstrapped) ghost
    // never decremented, so re-adding would over-credit stock the sale never
    // consumed. The born-CANCELLED decrement gate has no mirror here: this branch
    // is reached only for `dematerialized` (UnPacked) ghosts — the CANCELLED
    // intake is a separate branch checked after this one — so business-today is
    // the load-bearing reversal guard.
    const { deletedOrder, deletedBufferEntries } = await prisma.$transaction(async (tx) => {
      const ghost = await tx.order.findFirst({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
        select: {
          orderDate: true,
          items: {
            where: { productVariantId: { not: null } },
            select: {
              quantity: true,
              // Only lines that actually resolved a variant were decremented, so
              // only they are re-added; productId drives the totalStock recompute.
              productVariant: { select: { id: true, productId: true } },
            },
          },
        },
      });

      const affectedProductIds = new Set<string>();

      if (ghost !== null) {
        // The order row owns the decrement. Re-add its resolved-variant line
        // quantities when the ghost's business date is today — the exact condition
        // under which the optimistic decrement fired.
        if (isOrderOnBusinessToday(ghost.orderDate)) {
          for (const item of ghost.items) {
            if (item.productVariant === null) continue;
            await incrementVariantStock(tx, item.productVariant.id, item.quantity);
            affectedProductIds.add(item.productVariant.productId);
          }
        }
      } else {
        // No order row → a buffered ghost may have decremented at intake with no
        // orders row ever written. Re-add each buffer row's resolved-variant line
        // quantities, gated on the BUFFER row's own business date (the same gate
        // the buffered-intake decrement used). Lines are parsed out of the
        // mapped_order JSONB with this file's runtime-narrowing convention.
        const bufferRows = await tx.livePerformanceBuffer.findMany({
          where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
          select: { orderDate: true, mappedOrder: true },
        });
        for (const row of bufferRows) {
          if (!isOrderOnBusinessToday(row.orderDate)) continue;
          for (const line of parseBufferResolvableLines(row.mappedOrder)) {
            const variant = await tx.productVariant.findFirst({
              where: { storeId, barcode: line.barcode },
              select: { id: true, productId: true },
            });
            if (variant === null) continue;
            await incrementVariantStock(tx, variant.id, line.quantity);
            affectedProductIds.add(variant.productId);
          }
        }
      }

      await refreshProductAggregates(tx, storeId, [...affectedProductIds]);

      const orderDel = await tx.order.deleteMany({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
      });
      const bufferDel = await tx.livePerformanceBuffer.deleteMany({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
      });
      return { deletedOrder: orderDel.count > 0, deletedBufferEntries: bufferDel.count };
    });
    return {
      kind: 'dematerialized',
      deletedOrder,
      deletedBufferEntries,
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

  // Past-day cost-window gate (Berkin 2026-11-03). A past-day order's cost window
  // (its own business day) has already closed, so it enters profit ONLY when it is
  // calculable now AND every non-cancelled item had its cost entered before that day
  // ended. Otherwise -- no cost at all, or a cost entered only after the day (decision
  // 2) -- it is persisted but PERMANENTLY excluded with LATE_UNCOSTED_ARRIVAL. The
  // order is never cancelled here (the CANCELLED branch returned above), so every line
  // is non-cancelled.
  if (getBusinessDate(mapped.orderDate) < getBusinessDate()) {
    const hasTimelyCost =
      calc.kind === 'calculable' &&
      (await hadCostWithinOrderDay(prisma, {
        organizationId,
        storeId,
        orderDate: mapped.orderDate,
        items: calcLines.map((line) => ({
          productVariantId: line.variantId,
          isCancelled: false,
        })),
      }));
    if (hasTimelyCost) {
      await persistWithBufferGraduation(storeId, organizationId, mapped);
      return { kind: 'persisted', reason: 'calculable' };
    }
    // Past-day uncosted: the order is permanently excluded, but the REASON is derived
    // inside the persisting transaction (see persistWithBufferGraduation) from whether a
    // coexisting buffer row is graduated, not stamped unconditionally here -- so a buffered
    // order re-delivered just after midnight gets the same reason the day-end flush would.
    await persistWithBufferGraduation(storeId, organizationId, mapped, {
      pastDayUncosted: true,
    });
    return { kind: 'persisted', reason: 'late_uncosted_arrival' };
  }

  // Today's order from here. Fully costable -> persist with profit.
  if (calc.kind === 'calculable') {
    await persistWithBufferGraduation(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'calculable' };
  }

  // calc is { kind: 'skip', reason: 'cost_missing', ... } from here (today only).
  // Today's cost-missing — but if it is already in orders, persist (idempotent),
  // never create a parallel buffer row (double-count guard). Org-scoped query
  // (CLAUDE.md: every order read filters by organizationId — defense-in-depth).
  const existing = await prisma.order.findFirst({
    where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    select: { id: true },
  });
  if (existing !== null) {
    await persistWithBufferGraduation(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'already_in_orders' };
  }

  // Today's cost-missing, new → buffer (PENDING). Idempotent on (storeId,
  // platformOrderId): a re-delivery hits the composite unique → P2002 → dedupe.
  //
  // The create and the optimistic stock decrement share ONE transaction so the
  // buffer row and the stock movement commit atomically. A P2002 from the create
  // aborts the tx BEFORE the decrement runs, so a re-delivery (buffered_deduped)
  // never decrements a second time — the idempotency unique is what distinguishes
  // the genuinely-new 'buffered' outcome from a dedupe.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.livePerformanceBuffer.create({
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

      // Optimistic stock decrement at INTAKE (owner ruling 2026-07-11): the sale
      // happened on the marketplace the moment the order arrived, so local stock
      // drops immediately even while the order parks in the cost-missing buffer —
      // cost only affects profitability, never whether the unit left the shelf.
      // Same gates as the direct-persist decrement (upsert-order.ts): business-today
      // and non-CANCELLED. When this order later graduates from the buffer,
      // upsertOrderWithSnapshot is called with promotedFromBuffer=true and skips its
      // own decrement, so the units drop exactly once across the buffer→orders life.
      if (isOrderOnBusinessToday(mapped.orderDate) && mapped.status !== 'CANCELLED') {
        await decrementBufferedOrderStock(tx, storeId, mapped.lines);
      }
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
 * Persist an order that may still carry a live-performance buffer row for the same
 * (organizationId, storeId, platformOrderId), graduating it atomically (Faz 4A, Gorev 8).
 *
 * The invariant is that an order is NEVER in both `orders` and `live_performance_buffer`:
 * the Live Performance page unions the two for today (getKpis), so a coexisting order has
 * its revenue, order count and units counted twice. A cost-missing order parks in the
 * buffer; when its cost is attached or its variant resolves it becomes calculable, and a
 * re-delivery then reaches one of intakeOrder's persist branches. This deletes the buffer
 * row in the SAME transaction as the order write -- exactly like the buffer-promote worker
 * -- so the two never coexist, instead of leaving the row for the promote tick / midnight
 * flush.
 *
 * When a buffer row existed, its optimistic intake already decremented the matched
 * variants' stock, so the order write is flagged promotedFromBuffer to skip a second
 * decrement (the same gate the promote path uses). With no buffer row (the common direct
 * persist) the flag is false and the write decrements once as before.
 *
 * Tenant-scoped: the buffer delete filters organizationId + storeId (CLAUDE.md -- every
 * order/buffer read or write pins the tenant). When the caller flags pastDayUncosted, the
 * permanent exclusion reason is derived HERE from the SAME buffer-removal signal: a buffer
 * row was removed -> COST_DEADLINE_MISSED (the order arrived within its business day -- the
 * buffer only ever holds a same-day cost-missing order -- so it merely missed its cost
 * deadline, exactly what the midnight flush stamps); no buffer row -> LATE_UNCOSTED_ARRIVAL
 * (we first saw the order after its day had already closed). Computing it inside the
 * transaction is what fixes the race: a buffered order re-delivered just after midnight but
 * before the flush tick can no longer get a different reason depending on which side wins.
 */
async function persistWithBufferGraduation(
  storeId: string,
  organizationId: string,
  mapped: MappedOrder,
  opts?: { readonly pastDayUncosted: boolean },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const removed = await tx.livePerformanceBuffer.deleteMany({
      where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    });
    const graduated = removed.count > 0;
    const profitExclusion =
      opts?.pastDayUncosted === true
        ? {
            reason: graduated
              ? ProfitExclusionReason.COST_DEADLINE_MISSED
              : ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL,
          }
        : undefined;
    await upsertOrderWithSnapshot(storeId, organizationId, mapped, tx, {
      promotedFromBuffer: graduated,
      profitExclusion,
    });
  });
}

/**
 * Decrement local variant stock for a buffered order's resolved lines, in the
 * SAME transaction as the buffer insert. Mirrors the first-insert decrement in
 * upsert-order.ts: variant lookup by (storeId, barcode), subtract the sold
 * quantity, then recompute the owning products' denormalized totalStock. Only
 * lines whose barcode resolves to a variant move stock — an unmatched line
 * carries none. The business-today / non-CANCELLED gates are order-level, applied
 * by the caller.
 */
async function decrementBufferedOrderStock(
  tx: Prisma.TransactionClient,
  storeId: string,
  lines: MappedOrder['lines'],
): Promise<void> {
  const affectedProductIds = new Set<string>();
  for (const line of lines) {
    const variant = await tx.productVariant.findFirst({
      where: { storeId, barcode: line.barcode },
      select: { id: true, productId: true },
    });
    if (variant === null) continue;
    await decrementVariantStock(tx, variant.id, line.quantity);
    affectedProductIds.add(variant.productId);
  }
  await refreshProductAggregates(tx, storeId, [...affectedProductIds]);
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

interface BufferResolvableLine {
  barcode: string;
  quantity: number;
}

/**
 * Extract the resolvable (barcode + quantity) lines from a buffer row's
 * `mappedOrder` JSONB, using the same defensive runtime narrowing as
 * `parseBufferLastModified` — anything whose shape does not match is skipped.
 * Used by the dematerialize reversal to re-add a buffered ghost's optimistic
 * decrement when no orders row was ever written for it.
 */
function parseBufferResolvableLines(mappedOrder: Prisma.JsonValue): BufferResolvableLine[] {
  if (typeof mappedOrder !== 'object' || mappedOrder === null || Array.isArray(mappedOrder)) {
    return [];
  }
  const rawLines = mappedOrder['lines'];
  if (!Array.isArray(rawLines)) {
    return [];
  }
  const lines: BufferResolvableLine[] = [];
  for (const raw of rawLines) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      continue;
    }
    const barcode = raw['barcode'];
    const quantity = raw['quantity'];
    if (typeof barcode === 'string' && typeof quantity === 'number') {
      lines.push({ barcode, quantity });
    }
  }
  return lines;
}
