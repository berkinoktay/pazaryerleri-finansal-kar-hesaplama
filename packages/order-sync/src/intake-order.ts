/**
 * Shared order-intake routing — the single decision point used by BOTH the
 * webhook receiver (apps/api) and the polling sync-worker (apps/sync-worker)
 * so the two ingest paths behave identically (Slice 0, Decision 1A).
 *
 * Routing (see the spec's decision table + split research 2026-06-09 +
 * cost-deadline-profit-freeze spec 2026-06-12):
 *   - packagePending (no package id yet) → SKIP entirely (Awaiting order before the
 *                                      payment check; shipmentPackageId 0 can't be keyed,
 *                                      arrives again under a real id as Created)
 *   - dematerialized (UnPacked)    → DELETE order + buffer rows (split ghost — children re-carry content)
 *   - status CANCELLED             → purge buffer rows + upsert (audit row; aggregates exclude by status)
 *   - variant_not_found            → cost_missing route (order IS written; line keeps barcode, null variant FK; resolution in PR-2)
 *   - calculable + today           -> persist + graduate any buffer row (queue recompute)
 *   - past-day, day not settled yet -> buffer row exists: refresh its snapshot only;
 *                                      no buffer row: persist non-final, unexcluded
 *                                      (reason calculable or awaiting_day_close); the
 *                                      day-close pass decides it
 *   (every past-day row below: day settled, order created final)
 *   - past-day + timely cost + desi -> persist + graduate any buffer row (the queued recompute profits it)
 *   - past-day + cost missed day   -> persist + graduate any buffer row; the permanent
 *                                      exclusion reason is derived from the graduation
 *                                      (buffer row removed -> COST_DEADLINE_MISSED, else
 *                                      LATE_UNCOSTED_ARRIVAL)
 *   - past-day + timely cost + no desi -> persist + graduate any buffer row; reason
 *                                      DESI_DEADLINE_MISSED (buffer row removed) or
 *                                      LATE_DESILESS_ARRIVAL
 *   - cost/desi_missing + today + in orders -> persist + graduate any buffer row (idempotent)
 *   - cost/desi_missing + today + new → live_performance_buffer (PENDING, same-day cost/desi window)
 *
 * The "already in orders" guard prevents a phantom buffer row for an order that
 * was costed earlier then had its cost profile archived or detached: the gate then
 * reports the cost missing (plan PR-3b), and the order would otherwise live in
 * BOTH orders and buffer → double-count on the Live Performance page.
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
 * non-cancelled item had a cost in force at the end of the order's business day
 * (Europe/Istanbul midnight). Supply prices drift, so a cost entered after that day
 * may not reflect the day's real price. A past-day order that arrives without a
 * timely cost -- or one whose cost was entered only after its day (hadCostWithinOrderDay
 * false) -- is persisted but PERMANENTLY excluded from profit; its ciro still counts, its
 * net profit never shows. The exclusion reason is derived from whether a live-performance
 * buffer row for the same order is graduated in the persisting transaction: a coexisting
 * buffer row proves the order ARRIVED within its business day (the buffer only holds
 * same-day waiting orders) and merely missed its deadline; with no buffer row we first saw
 * the order after its day had closed.
 *
 * Same-day edit window (Berkin 2026-11-23, plan PR-1): an order's cost and desi are the
 * values in force at the end of its business day T, and they become final once the day
 * is settled by the database clock (`resolveSettledCutoff`: T plus the settle delay, with
 * no open transaction that began before T). Only a settled past day is decided at
 * intake, as above, and its order is created final. Before the cutoff a past-day order
 * is never excluded or made final here: a coexisting buffer row is only refreshed (the
 * day-end flush graduates it), otherwise the order is stored non-final and the day-close
 * pass decides it.
 *
 * Desi rule (Berkin 2026-11-22, plan PR-2c): the gate (`resolveOrderCalculability`) wants
 * a cost AND an effective desi (override ?? synced; any stored value counts, a seller
 * desi is at least 1) on every
 * non-digital item. Today's desiless order waits in the buffer exactly like a cost-missing
 * one. For a past-day order both are judged as they stood at the end of the order's
 * business day: the cost links in force then, and the desi in force then (rebuilt from
 * the trigger-written desi history by `loadSellerInputsAt`), so a desi entered after
 * that day does not count. The order's cargo-measured desi (`cargoDeci`) never stands in
 * for a product desi. Reasons, with the cost winning when both are missing:
 *
 *                       buffer row graduated     no buffer row
 *   cost missed day     COST_DEADLINE_MISSED     LATE_UNCOSTED_ARRIVAL
 *   cost ok, no desi    DESI_DEADLINE_MISSED     LATE_DESILESS_ARRIVAL
 *
 * A missing commission / carrier never excludes, and a cancelled order is never excluded
 * (its CANCELLED branch returns above). The order is still enqueued for a profit
 * recompute like every other write. This supersedes the phase-3B "no auto-exclusion"
 * stance. The live-performance buffer still owns the same-day cost/desi window for
 * today's orders.
 */

import { refreshProductAggregates } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import { Prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import {
  buildCalcCheckLines,
  costDecisionTime,
  findFirstVariantByBarcode,
  resolveOrderCalculability,
  resolveSettledCutoff,
} from '@pazarsync/profit';
import { getBusinessDate, getBusinessDateAnchor, isDaySettled } from '@pazarsync/utils';

import { hadCostWithinOrderDay } from './cost-window';
import { type PastDayGap, pastDayGapReason } from './past-day-gap';
import { decrementVariantStock, incrementVariantStock, isOrderOnBusinessToday } from './stock';
import { upsertOrderWithSnapshot } from './upsert-order';

export type OrderIntakeOutcome =
  | {
      kind: 'persisted';
      // awaiting_day_close: a past-day order whose day is not settled yet, stored
      // non-final and unexcluded although its cost or desi is missing; the day-close
      // pass decides it once the day is settled (same-day edit window).
      reason:
        | 'calculable'
        | 'late_uncosted_arrival'
        | 'late_desiless_arrival'
        | 'awaiting_day_close'
        | 'already_in_orders'
        | 'cancelled_audit';
    }
  | { kind: 'buffered' }
  // `refreshed` is an OPTIONAL flag (never a new kind) on purpose: consumers with
  // an exhaustive `switch (outcome.kind)` keep compiling untouched, while callers
  // that care can tell a plain dedupe from one that refreshed the buffer snapshot.
  | { kind: 'buffered_deduped'; refreshed?: boolean }
  | { kind: 'dematerialized'; deletedOrder: boolean; deletedBufferEntries: number }
  // Trendyol has not created the shipment package yet (shipmentPackageId 0 —
  // an Awaiting order before the payment check). It cannot be keyed (every one
  // would be platformOrderId '0'), so intake skips it with no DB access at all.
  | { kind: 'skipped'; reason: 'package_pending' };

interface IntakeOrderArgs {
  storeId: string;
  organizationId: string;
  mapped: MappedOrder;
  /**
   * Original vendor payload for the buffer's `raw_payload` (required column).
   * The webhook passes the Trendyol payload; the sync-worker has only the mapped
   * DTO, so when omitted the mapped order doubles as the raw snapshot.
   */
  rawPayload?: Prisma.InputJsonValue;
  /**
   * Test seam (same-day edit window): the database clock the settled cutoff of a
   * past-day order is resolved with. Production reads the database clock.
   */
  dbNow?: Date;
}

export async function intakeOrder(args: IntakeOrderArgs): Promise<OrderIntakeOutcome> {
  const { storeId, organizationId, mapped } = args;

  // ─── Package not created yet (Awaiting, shipmentPackageId 0) ─────────────
  // Trendyol reports shipmentPackageId 0 for a package it has not created yet —
  // an Awaiting order still waiting on the payment check. Every such package
  // maps to platformOrderId '0', so distinct order numbers would collide onto a
  // single orders / buffer row (last write wins). Skip it entirely — no DB read
  // or write of any kind (no order, no buffer row, no stock change, no recompute
  // enqueue). Trendyol re-sends the same order under a real shipmentPackageId
  // once it creates the package (status Created), and that one is keyed normally.
  if (mapped.packagePending) {
    return { kind: 'skipped', reason: 'package_pending' };
  }

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
            // The same variant the buffered decrement chose (findFirstVariantByBarcode,
            // organization + store scoped), so the restock undoes exactly that move.
            const variant = await findFirstVariantByBarcode(tx, {
              organizationId,
              storeId,
              barcode: line.barcode,
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

  // The cost rule judges links at the end of the order's business day (plan PR-3b):
  // the current state for today's order, that day's end for a past-day one.
  const calcLines = await buildCalcCheckLines(prisma, {
    organizationId,
    storeId,
    lines: mapped.lines,
    at: costDecisionTime(mapped.orderDate),
  });
  const calc = resolveOrderCalculability(calcLines);

  // Past-day cost-window + desi gate (Berkin 2026-11-03, 2026-11-22, 2026-11-23). A
  // past-day order's window (its own business day) has already closed, so it enters
  // profit ONLY when every non-cancelled item had a cost in force at that day's end AND
  // the gate is calculable: both the cost links and the desi are judged as they stood at
  // that day end (`buildCalcCheckLines` at `costDecisionTime`, rebuilt from the
  // database-stamped seller-input history), never as they stand now. Otherwise it is
  // persisted but PERMANENTLY excluded. The cost is judged first and wins: no cost at
  // all, or a cost entered only after the day (decision 2), is a cost gap; a timely cost
  // with an item that had no desi at the day end is a desi gap. The exclusion reason is
  // derived in persistWithBufferGraduation from the gap and from whether a buffer row is
  // graduated. When the gate already reports a missing cost, the timing query is
  // skipped. The order is never cancelled here (the CANCELLED branch returned above), so
  // every line is non-cancelled.
  //
  // Same-day edit window (Berkin 2026-11-23, plan PR-1): the app clock above only
  // routes. Whether the order's day is settled -- its seller inputs final -- is read
  // from the database clock (resolveSettledCutoff), only on this branch. A day that is
  // not settled yet decides nothing here (intakeUnsettledPastDay); a settled day keeps
  // the rule above and its order is created final, its exclusion decided at create.
  if (getBusinessDate(mapped.orderDate) < getBusinessDate()) {
    const settle = await resolveSettledCutoff(prisma, { dbNow: args.dbNow });
    if (!isDaySettled(mapped.orderDate, settle.cutoff)) {
      return intakeUnsettledPastDay(args, calc.kind === 'calculable');
    }
    const sellerInputsFinalAt = settle.dbNow;
    const costTimely =
      !(calc.kind === 'skip' && calc.reason === 'cost_missing') &&
      (await hadCostWithinOrderDay(prisma, {
        organizationId,
        storeId,
        orderDate: mapped.orderDate,
        items: calcLines.map((line) => ({
          productVariantId: line.variantId,
          isCancelled: false,
        })),
      }));
    if (costTimely && calc.kind === 'calculable') {
      await persistWithBufferGraduation(storeId, organizationId, mapped, { sellerInputsFinalAt });
      return { kind: 'persisted', reason: 'calculable' };
    }
    // Past-day gap: the order is permanently excluded, but the REASON is derived inside
    // the persisting transaction (see persistWithBufferGraduation) from whether a
    // coexisting buffer row is graduated, not stamped unconditionally here -- so a buffered
    // order re-delivered after its day settled gets the same reason the day-end flush would.
    const pastDayGap = costTimely ? 'desi' : 'cost';
    await persistWithBufferGraduation(storeId, organizationId, mapped, {
      pastDayGap,
      sellerInputsFinalAt,
    });
    return {
      kind: 'persisted',
      reason: pastDayGap === 'cost' ? 'late_uncosted_arrival' : 'late_desiless_arrival',
    };
  }

  // Today's order from here. Fully calculable (cost + desi) -> persist with profit.
  if (calc.kind === 'calculable') {
    await persistWithBufferGraduation(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'calculable' };
  }

  // calc is { kind: 'skip', reason: 'cost_missing' | 'desi_missing', ... } from here
  // (today only): both wait in the buffer until the seller enters the missing value.
  // Today's waiting order — but if it is already in orders, persist (idempotent),
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

  // Today's cost- or desi-missing, new → buffer (PENDING). Idempotent on (storeId,
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
        await decrementBufferedOrderStock(tx, { organizationId, storeId }, mapped.lines);
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
 * order/buffer read or write pins the tenant). When the caller passes a pastDayGap, the
 * permanent exclusion reason is derived HERE from that gap and the SAME buffer-removal
 * signal (PAST_DAY_GAP_REASONS): a buffer row was removed -> the deadline reason
 * (COST_DEADLINE_MISSED / DESI_DEADLINE_MISSED: the order arrived within its business day
 * -- the buffer only ever holds a same-day waiting order -- so it merely missed its
 * deadline, exactly what the midnight flush stamps); no buffer row -> the late-arrival
 * reason (LATE_UNCOSTED_ARRIVAL / LATE_DESILESS_ARRIVAL: we first saw the order after its
 * day had already closed). Computing it inside the transaction is what fixes the race: a
 * buffered order re-delivered after its day settled but before the flush tick can no
 * longer get a different reason depending on which side wins.
 *
 * `sellerInputsFinalAt` (same-day edit window) is passed only for a settled past day: the
 * order is then created final, with its exclusion decided at create. Both are written on
 * a genuine create only.
 */
async function persistWithBufferGraduation(
  storeId: string,
  organizationId: string,
  mapped: MappedOrder,
  opts?: { readonly pastDayGap?: PastDayGap; readonly sellerInputsFinalAt?: Date },
): Promise<void> {
  const pastDayGap = opts?.pastDayGap;
  await prisma.$transaction(async (tx) => {
    const removed = await tx.livePerformanceBuffer.deleteMany({
      where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    });
    const graduated = removed.count > 0;
    const profitExclusion =
      pastDayGap === undefined
        ? undefined
        : { reason: pastDayGapReason(pastDayGap, graduated ? 'graduated' : 'direct') };
    await upsertOrderWithSnapshot(storeId, organizationId, mapped, tx, {
      promotedFromBuffer: graduated,
      profitExclusion,
      sellerInputsFinalAt: opts?.sellerInputsFinalAt,
    });
  });
}

/**
 * Intake of a past-day order whose business day is not settled yet (same-day edit
 * window, Berkin 2026-11-23, plan PR-1). Until the settled cutoff a seller-input write
 * that began before the day end may still commit rows stamped inside the day, so
 * nothing is decided here: no exclusion and no final marker.
 *   - A buffer row for the order exists (it waited during its day): only that row's
 *     snapshot is refreshed (`refreshBufferSnapshot`, a newer event on a PENDING row);
 *     the day-end flush graduates it after the cutoff with the day-end state.
 *   - No buffer row: the order is persisted non-final and unexcluded. Its seller
 *     inputs follow its day; the day-close pass makes it final and decides the
 *     exclusion. The reason reports whether the gate is calculable now.
 * Tenant-scoped: the buffer read filters organizationId + storeId.
 */
async function intakeUnsettledPastDay(
  args: IntakeOrderArgs,
  calculable: boolean,
): Promise<OrderIntakeOutcome> {
  const { storeId, organizationId, mapped } = args;
  const buffered = await prisma.livePerformanceBuffer.findFirst({
    where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    select: { id: true },
  });
  if (buffered !== null) {
    return refreshBufferSnapshot(args);
  }
  await persistWithBufferGraduation(storeId, organizationId, mapped);
  return { kind: 'persisted', reason: calculable ? 'calculable' : 'awaiting_day_close' };
}

/**
 * Decrement local variant stock for a buffered order's resolved lines, in the
 * SAME transaction as the buffer insert. Mirrors the first-insert decrement in
 * upsert-order.ts: variant lookup by (organizationId, storeId, barcode) through
 * `findFirstVariantByBarcode`, subtract the sold quantity, then recompute the owning
 * products' denormalized totalStock. Only lines whose barcode resolves to a variant
 * of the organization's store move stock — an unmatched line carries none. The
 * business-today / non-CANCELLED gates are order-level, applied by the caller.
 */
async function decrementBufferedOrderStock(
  tx: Prisma.TransactionClient,
  scope: { organizationId: string; storeId: string },
  lines: MappedOrder['lines'],
): Promise<void> {
  const affectedProductIds = new Set<string>();
  for (const line of lines) {
    const variant = await findFirstVariantByBarcode(tx, {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      barcode: line.barcode,
    });
    if (variant === null) continue;
    await decrementVariantStock(tx, variant.id, line.quantity);
    affectedProductIds.add(variant.productId);
  }
  await refreshProductAggregates(tx, scope.storeId, [...affectedProductIds]);
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
 *
 * Tenant-scoped: the read and the write filter organizationId + storeId, so a
 * delivery whose store id belongs to another organization never rewrites that
 * organization's buffer row (it is reported as a plain dedupe).
 */
async function refreshBufferSnapshot(args: {
  organizationId: string;
  storeId: string;
  mapped: MappedOrder;
  rawPayload?: Prisma.InputJsonValue;
}): Promise<OrderIntakeOutcome> {
  const { organizationId, storeId, mapped } = args;

  const existing = await prisma.livePerformanceBuffer.findUnique({
    where: {
      storeId_platformOrderId: { storeId, platformOrderId: mapped.platformOrderId },
      organizationId,
    },
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
    where: { id: existing.id, organizationId, storeId, status: 'PENDING' },
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
