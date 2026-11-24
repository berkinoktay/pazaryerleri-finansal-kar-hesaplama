/**
 * The day-close finaliser of one order (same-day edit window, plan P1-17; notes B3, D8;
 * amendment C1). Owner rule (Berkin 2026-11-23): an order's cost and desi are the values
 * in force at the end of its Istanbul business day T; a change during the day reaches
 * all of that day's orders, and at 00:00 the seller inputs become final. Marketplace
 * data keeps updating the profit afterwards.
 *
 * Once the order's day is settled (the caller's `SettledCutoff`), the finaliser
 * re-derives the order's items at T one last time, marks the order final
 * (`orders.seller_inputs_final_at`), stamps the permanent past-day exclusion when the
 * items show a cost or desi gap at T, and enqueues a DAY_CLOSE recompute. A stored order
 * and its buffered twin end the day with the same reason: the same gap rule
 * (`dayCloseGap`, cost first) and the same reason table (`pastDayGapReason`), with
 * `created_at` choosing between the deadline reason (stored by T) and the late reason
 * (first stored after T), as in the cost-window backfill.
 *
 * Lock order (the contract; notes D11): parcel advisory lock -> orders row ->
 * order_items -> orders row -> queue row, the same order as the recompute and as intake
 * (orders row first, its items afterwards). The finaliser never waits on either lock:
 *   - the advisory lock is only tried; when a recompute of the order holds it, the order
 *     is `busy` and the next tick retries;
 *   - the orders row is taken `FOR NO KEY UPDATE SKIP LOCKED`; a row intake holds is
 *     skipped (`busy`), so the finaliser cannot deadlock with intake, and the status is
 *     read under the lock, so an order cancelled meanwhile is never stamped.
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: a seller-input writer that inserts a fresh
 * queue row for the same order takes a key-share lock on the orders row for the foreign
 * key check, which `FOR UPDATE` would block while the finaliser's own queue insert then
 * waits for the writer's uncommitted row -- a deadlock. `FOR NO KEY UPDATE` lets the
 * writer through and still conflicts with intake's `UPDATE`. The one wait left is the
 * final enqueue behind such a writer's uncommitted queue row, bounded by the writer's
 * transaction timeout (`SELLER_INPUT_TX_OPTIONS`).
 *
 * Tenant-scoped: every read and write filters the caller's organization and store; an
 * order id of another store or organization is never locked and reads as `busy`.
 */

import type { Prisma } from '@pazarsync/db';
import {
  OrderStatus,
  Platform,
  type ProfitExclusionReason,
  ProfitRecomputeReason,
} from '@pazarsync/db/enums';
import {
  captureOrderProfitSnapshot,
  enqueueProfitRecompute,
  tryAcquireParcelProfitLock,
} from '@pazarsync/profit';
import { getBusinessDayRange, isDaySettled } from '@pazarsync/utils';

import { type PastDayGap, pastDayGapReason } from './past-day-gap';

/** B2: the ONLY switch for the day-close desi exclusion. ON (owner decided 2026-11-23, amendment C1). */
export const DAY_CLOSE_STAMPS_MISSING_DESI = true;

/** One order item as the day-close gap check reads it, after its re-derive at T. */
export interface DayCloseLine {
  readonly productVariantId: string | null;
  readonly costVersionIds: readonly string[] | null;
  readonly unitDesi: Prisma.Decimal | null;
  readonly isDigital: boolean | null;
}

/** An item without a cost at T: unmatched, or an empty (or null) cost list. */
function lacksCost(line: DayCloseLine): boolean {
  return (
    line.productVariantId === null ||
    line.costVersionIds === null ||
    line.costVersionIds.length === 0
  );
}

/**
 * A matched, non-digital item without a desi at T. Any stored value counts, a 0
 * included (as in `resolveOrderCalculability`); an unmatched item is a cost gap instead.
 */
function lacksDesi(line: DayCloseLine): boolean {
  return line.productVariantId !== null && line.isDigital !== true && line.unitDesi === null;
}

/** Pure: the gap the re-derived items show at T. Cost wins; an unmatched line is a cost gap. */
export function dayCloseGap(lines: readonly DayCloseLine[]): PastDayGap | null {
  if (lines.some(lacksCost)) {
    return 'cost';
  }
  if (lines.some(lacksDesi)) {
    return 'desi';
  }
  return null;
}

/** B2 isolation: the one place that decides whether a day-close desi gap is stamped. */
export function dayCloseStampedGap(
  gap: PastDayGap | null,
  opts: { readonly stampMissingDesi?: boolean } = {},
): PastDayGap | null {
  const stampMissingDesi = opts.stampMissingDesi ?? DAY_CLOSE_STAMPS_MISSING_DESI;
  if (gap === 'desi' && !stampMissingDesi) {
    return null;
  }
  return gap;
}

/** What one finaliser call did with its order. */
export type FinalizeOutcome =
  | { readonly kind: 'finalized'; readonly exclusion: ProfitExclusionReason | null }
  | { readonly kind: 'skipped'; readonly reason: 'busy' | 'already_final' | 'not_settled' };

const BUSY: FinalizeOutcome = { kind: 'skipped', reason: 'busy' };

/** The caller's scope of one order. */
interface OrderScope {
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
}

/**
 * Takes the order's row lock without waiting (`FOR NO KEY UPDATE SKIP LOCKED`, see the
 * module comment) and reads the row under it. Null when another transaction holds the
 * row, or when no order of this organization and store has the id.
 */
async function lockOrderRow(
  tx: Prisma.TransactionClient,
  scope: OrderScope,
): Promise<{
  readonly status: OrderStatus;
  readonly orderDate: Date;
  readonly createdAt: Date;
  readonly sellerInputsFinalAt: Date | null;
  readonly profitExcludedAt: Date | null;
} | null> {
  const { organizationId, storeId, orderId } = scope;
  const locked = await tx.$queryRaw<unknown[]>`
    SELECT id FROM orders
     WHERE id = ${orderId}::uuid
       AND organization_id = ${organizationId}::uuid
       AND store_id = ${storeId}::uuid
     FOR NO KEY UPDATE SKIP LOCKED`;
  if (locked.length === 0) {
    return null;
  }
  // Read under the lock: this statement sees the latest committed row (READ COMMITTED),
  // so an intake that cancelled the order and committed before the lock is seen here.
  return tx.order.findFirst({
    where: { id: orderId, organizationId, storeId },
    select: {
      status: true,
      orderDate: true,
      createdAt: true,
      sellerInputsFinalAt: true,
      profitExcludedAt: true,
    },
  });
}

/**
 * The exclusion the order's items earn at T, read after their re-derive: the gap
 * (`dayCloseGap`, through the B2 switch) and how the order arrived -- stored by T is the
 * deadline reason, first stored after T the late reason.
 */
async function dayCloseExclusion(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly orderId: string;
    readonly orderDate: Date;
    readonly createdAt: Date;
    readonly stampMissingDesi: boolean | undefined;
  },
): Promise<ProfitExclusionReason | null> {
  const { organizationId, orderId, orderDate, createdAt, stampMissingDesi } = params;
  const items = await tx.orderItem.findMany({
    where: { orderId, organizationId },
    orderBy: { id: 'asc' },
    select: {
      snapshotProductVariantId: true,
      snapshotCostProfileVersionIds: true,
      snapshotUnitDesi: true,
      snapshotIsDigital: true,
    },
  });
  // Every item is captured by now, so its captured variant is the one it is priced
  // with; a variant deleted from the catalogue later keeps its captured inputs.
  const gap = dayCloseStampedGap(
    dayCloseGap(
      items.map((item) => ({
        productVariantId: item.snapshotProductVariantId,
        costVersionIds: item.snapshotCostProfileVersionIds,
        unitDesi: item.snapshotUnitDesi,
        isDigital: item.snapshotIsDigital,
      })),
    ),
    { stampMissingDesi },
  );
  if (gap === null) {
    return null;
  }
  const dayEnd = getBusinessDayRange(orderDate).end;
  return pastDayGapReason(gap, createdAt.getTime() > dayEnd.getTime() ? 'direct' : 'graduated');
}

/**
 * Sets the marker (and the exclusion, when there is one) on the locked, non-final row.
 * Throws when no row changed: the row is locked by this transaction, so that means a
 * broken invariant, never a race.
 */
async function markFinal(
  tx: Prisma.TransactionClient,
  scope: OrderScope,
  params: { readonly dbNow: Date; readonly exclusion: ProfitExclusionReason | null },
): Promise<void> {
  const { organizationId, storeId, orderId } = scope;
  const { dbNow, exclusion } = params;
  const updated = await tx.order.updateMany({
    where: { id: orderId, organizationId, storeId, sellerInputsFinalAt: null },
    data: {
      sellerInputsFinalAt: dbNow,
      // The exclusion columns are written only with a reason: the permanence trigger
      // fires on the columns named in the SET list.
      ...(exclusion !== null && { profitExcludedAt: dbNow, profitExclusionReason: exclusion }),
    },
  });
  if (updated.count !== 1) {
    throw new Error(`day close: the locked order ${orderId} was not marked final`);
  }
}

/**
 * Makes one order's seller inputs final at the end of its business day, in the caller's
 * transaction (see the module comment for the lock order). `cutoff` and `dbNow` are the
 * tick's `SettledCutoff`; `stampMissingDesi` is a test seam for the B2 switch.
 *
 * Outcomes: `skipped/busy` (a recompute holds the order, intake holds its row, or the
 * id is not this organization's and store's), `skipped/already_final`,
 * `skipped/not_settled` (the order's day end is after the cutoff), or `finalized` with
 * the exclusion it was stamped with (null when none). A cancelled order, an order that
 * already carries an exclusion, and an order of a store whose platform the engine cannot
 * compute are finalised without a stamp; the last one is neither captured nor enqueued.
 */
export async function finalizeOrderSellerInputs(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly orderId: string;
    /** `SettledCutoff.cutoff` of this tick. */
    readonly cutoff: Date;
    /** `SettledCutoff.dbNow` of this tick: the marker and the exclusion stamp. */
    readonly dbNow: Date;
    /** Test seam for the B2 switch; defaults to DAY_CLOSE_STAMPS_MISSING_DESI. */
    readonly stampMissingDesi?: boolean;
  },
): Promise<FinalizeOutcome> {
  const { organizationId, storeId, orderId, cutoff, dbNow, stampMissingDesi } = params;
  const scope: OrderScope = { organizationId, storeId, orderId };

  // 1. A recompute of this order is running: the next tick retries.
  if (!(await tryAcquireParcelProfitLock(tx, orderId))) {
    return BUSY;
  }
  // 2. The orders row, never waited for.
  const order = await lockOrderRow(tx, scope);
  if (order === null) {
    return BUSY;
  }
  // 3. Nothing to decide yet, or any more.
  if (order.sellerInputsFinalAt !== null) {
    return { kind: 'skipped', reason: 'already_final' };
  }
  if (!isDaySettled(order.orderDate, cutoff)) {
    return { kind: 'skipped', reason: 'not_settled' };
  }

  // 4. The engine captures and computes Trendyol orders only: another platform's order
  // is marked final and left alone.
  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId },
    select: { platform: true },
  });
  if (store === null) {
    throw new Error(`day close: the store of order ${orderId} was not found`);
  }
  if (store.platform !== Platform.TRENDYOL) {
    await markFinal(tx, scope, { dbNow, exclusion: null });
    return { kind: 'finalized', exclusion: null };
  }

  // 5. The marker is still NULL, so the capture re-derives every item at T. This is the
  // first statement that touches order_items.
  await captureOrderProfitSnapshot(tx, { organizationId, orderId });

  // 6. A cancelled order carries no payout and is never excluded; an existing exclusion
  // is never replaced.
  const exclusion =
    order.status !== OrderStatus.CANCELLED && order.profitExcludedAt === null
      ? await dayCloseExclusion(tx, {
          organizationId,
          orderId,
          orderDate: order.orderDate,
          createdAt: order.createdAt,
          stampMissingDesi,
        })
      : null;

  // 7. The marker, and the stamp when there is one.
  await markFinal(tx, scope, { dbNow, exclusion });

  // 8. The DAY_CLOSE recompute applies the final inputs (or the exclusion).
  await enqueueProfitRecompute(tx, {
    organizationId,
    storeId,
    orderIds: [orderId],
    reason: ProfitRecomputeReason.DAY_CLOSE,
  });

  return { kind: 'finalized', exclusion };
}
