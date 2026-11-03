/**
 * Cost-window rule (Berkin 2026-11-03): an order enters net profit only when
 * every non-cancelled item had its cost entered BEFORE the order's business day
 * ended (Europe/Istanbul midnight). Supply prices drift, so a cost entered after
 * that day may not reflect the day's real price -- an order that misses the window
 * is permanently excluded from profit (ciro still counts). This module answers the
 * single question the two exclusion writers ask: did the cost arrive in time?
 *
 * See docs/plans/2026-11-03-profit-engine-faz-3e-plan.md (decision 1) and the root
 * CLAUDE.md money/tenant rules. Callers: intake-order (past-day route) and the
 * sync-worker buffer day-end graduation.
 */

import type { Prisma } from '@pazarsync/db';
import { OrderStatus, ProfitExclusionReason, ProfitRecomputeReason } from '@pazarsync/db/enums';
import { enqueueProfitRecompute } from '@pazarsync/profit';
import { getBusinessDayRange } from '@pazarsync/utils';

/**
 * True iff, for EVERY non-cancelled item, the resolved variant had a cost in time:
 *   - the item's `productVariantId` is set (an unresolved line can never be costed);
 *   - the variant has at least one `product_variant_cost_profiles` link attached on
 *     or before the order's day end; and
 *   - that link's profile (same organization) has at least one
 *     `cost_profile_versions` row effective on or before the order's day end.
 *
 * Cancelled items are skipped (a cancelled line needs no cost). An order with no
 * non-cancelled item has nothing to cost, so it qualifies (returns true).
 *
 * The day end is the end of the order's business day, taken from the single
 * APP_TIME_ZONE helper (`getBusinessDayRange`) that intake-order uses to split
 * "today" from a past day -- never a hand-rolled timezone calculation.
 * `getBusinessDayRange(orderDate).end` is the first instant of the next business
 * day (the order day's closing midnight). The query filters with `lte`, so that
 * boundary instant itself still counts (plan decision 1: the day end is inclusive);
 * only a cost attached or effective strictly after it is too late.
 *
 * One tenant-scoped query (plus the in-memory coverage check): every filter pins
 * `organization_id` and `store_id`, so the lookup can never read another tenant's
 * cost data. No N+1 -- all variants are resolved in a single `in` query.
 */
export async function hadCostWithinOrderDay(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly orderDate: Date;
    readonly items: readonly {
      readonly productVariantId: string | null;
      readonly isCancelled: boolean;
    }[];
  },
): Promise<boolean> {
  // Cancelled items are out of scope: a cancelled line never needs a cost.
  const required = params.items.filter((item) => !item.isCancelled);

  // Nothing to cost -> the order trivially satisfies the window.
  if (required.length === 0) {
    return true;
  }

  // An unresolved variant can never carry a cost, so a single such non-cancelled
  // line already fails the window -- short-circuit before touching the database.
  if (required.some((item) => item.productVariantId === null)) {
    return false;
  }

  const variantIds = [
    ...new Set(
      required.map((item) => item.productVariantId).filter((id): id is string => id !== null),
    ),
  ];

  // The order day's closing midnight (first instant of the next business day).
  // Used with `lte` below, so this boundary instant is inclusive -- a cost attached
  // or effective exactly at it still counts (plan decision 1: the day end is included).
  const dayEnd = getBusinessDayRange(params.orderDate).end;

  // Tenant-scoped: the variants (of THIS organization + store) that carry a cost
  // profile link attached on or before the day end whose profile (same org) has a
  // version effective on or before the day end. `distinct` collapses a variant's
  // multiple links to a single row so coverage is a plain set membership check.
  const timelyLinks = await tx.productVariantCostProfile.findMany({
    where: {
      organizationId: params.organizationId,
      productVariantId: { in: variantIds },
      attachedAt: { lte: dayEnd },
      productVariant: { storeId: params.storeId },
      profile: {
        organizationId: params.organizationId,
        versions: { some: { effectiveFrom: { lte: dayEnd } } },
      },
    },
    select: { productVariantId: true },
    distinct: ['productVariantId'],
  });

  const covered = new Set(timelyLinks.map((link) => link.productVariantId));
  return variantIds.every((id) => covered.has(id));
}

/** Orders scanned per chunk. Bounds how many orders + items are held in memory
 * at once so a store with a large back catalogue never loads whole into RAM. */
const BACKFILL_CHUNK_SIZE = 500;

/**
 * Operator backfill (Faz 3E, Task 4): stamp the cost-window exclusion on a store's
 * EXISTING orders so historic data obeys the same rule the two live writers enforce.
 *
 * A candidate is one of the store's orders that is:
 *   - not CANCELLED (a cancel carries no payout and is never excluded);
 *   - not already excluded (`profit_excluded_at IS NULL`); and
 *   - from a business day that has ENDED relative to `now` -- the SAME past-day
 *     convention intake-order.ts uses for an order's orderDate
 *     (`getBusinessDate(orderDate) < getBusinessDate(now)`), expressed here as the
 *     instant comparison `orderDate < getBusinessDayRange(now).start` so the scan
 *     can prefilter on the indexed `order_date` column.
 *
 * For each candidate every non-cancelled line (order_items carries no per-line
 * cancel flag, so every line counts) is fed to `hadCostWithinOrderDay`. When the
 * window was missed the order is stamped:
 *   - `LATE_UNCOSTED_ARRIVAL` when our first record of it (`created_at`) is after
 *     the SAME day end the window used (`getBusinessDayRange(orderDate).end`) -- it
 *     arrived after its day had already closed; otherwise
 *   - `COST_DEADLINE_MISSED` -- it was here in time but its cost never was.
 *
 * Unless `dryRun`, the stamp is written with an update guarded by
 * `profit_excluded_at IS NULL` (plus the org + store filter) so it can only add an
 * exclusion, never overwrite one, and the stamped orders are enqueued for a profit
 * recompute (MANUAL) in the SAME transaction. `dryRun` returns the counts that a
 * real run would produce without writing a stamp or a queue row.
 *
 * Tenant-scoped: every query here (candidate scan, cost check, stamp, enqueue)
 * filters `organization_id` and `store_id`. Candidates are walked in id order via
 * keyset pagination in bounded chunks; the per-order cost check issues one query
 * per order, which is acceptable for an operator script run off the hot path.
 */
export async function stampCostWindowExclusions(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly now: Date;
    readonly dryRun: boolean;
  },
): Promise<{ readonly costDeadlineMissed: number; readonly lateUncostedArrival: number }> {
  const { organizationId, storeId, now, dryRun } = params;

  // Instant form of intake's `getBusinessDate(orderDate) < getBusinessDate(now)`:
  // an order is past-day iff its orderDate falls before the start of today's
  // business day. Lets the scan filter on the indexed order_date column.
  const todayStart = getBusinessDayRange(now).start;

  let costDeadlineMissed = 0;
  let lateUncostedArrival = 0;
  let cursor: string | null = null;

  for (;;) {
    const where: Prisma.OrderWhereInput = {
      organizationId,
      storeId,
      status: { not: OrderStatus.CANCELLED },
      profitExcludedAt: null,
      orderDate: { lt: todayStart },
    };
    // Keyset pagination: advance strictly past the last id of the previous chunk.
    if (cursor !== null) {
      where.id = { gt: cursor };
    }
    const candidates = await tx.order.findMany({
      where,
      orderBy: { id: 'asc' },
      take: BACKFILL_CHUNK_SIZE,
      select: {
        id: true,
        orderDate: true,
        createdAt: true,
        items: { select: { productVariantId: true } },
      },
    });

    if (candidates.length === 0) {
      break;
    }

    const costMissedIds: string[] = [];
    const lateArrivalIds: string[] = [];

    for (const order of candidates) {
      const hadTimelyCost = await hadCostWithinOrderDay(tx, {
        organizationId,
        storeId,
        orderDate: order.orderDate,
        items: order.items.map((item) => ({
          productVariantId: item.productVariantId,
          isCancelled: false,
        })),
      });
      if (hadTimelyCost) {
        continue;
      }
      // The same day end the window used: an order first stored after it closed
      // arrived late; one stored on or before it simply never got its cost.
      const dayEnd = getBusinessDayRange(order.orderDate).end;
      if (order.createdAt.getTime() > dayEnd.getTime()) {
        lateArrivalIds.push(order.id);
      } else {
        costMissedIds.push(order.id);
      }
    }

    costDeadlineMissed += costMissedIds.length;
    lateUncostedArrival += lateArrivalIds.length;

    if (!dryRun) {
      await stampAndEnqueue(tx, {
        organizationId,
        storeId,
        now,
        reason: ProfitExclusionReason.COST_DEADLINE_MISSED,
        orderIds: costMissedIds,
      });
      await stampAndEnqueue(tx, {
        organizationId,
        storeId,
        now,
        reason: ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL,
        orderIds: lateArrivalIds,
      });
    }

    const lastId = candidates[candidates.length - 1]?.id;
    if (lastId === undefined || candidates.length < BACKFILL_CHUNK_SIZE) {
      break;
    }
    cursor = lastId;
  }

  return { costDeadlineMissed, lateUncostedArrival };
}

/**
 * Stamp one reason onto a batch of orders and enqueue them for a MANUAL recompute,
 * all inside the caller's transaction. The update is guarded by
 * `profit_excluded_at IS NULL` (plus the org + store filter) so it only ever ADDS
 * an exclusion -- it can never overwrite one, matching the permanence trigger.
 */
async function stampAndEnqueue(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly now: Date;
    readonly reason: ProfitExclusionReason;
    readonly orderIds: readonly string[];
  },
): Promise<void> {
  const { organizationId, storeId, now, reason, orderIds } = params;
  if (orderIds.length === 0) {
    return;
  }
  await tx.order.updateMany({
    where: {
      id: { in: [...orderIds] },
      organizationId,
      storeId,
      profitExcludedAt: null,
    },
    data: { profitExcludedAt: now, profitExclusionReason: reason },
  });
  await enqueueProfitRecompute(tx, {
    organizationId,
    storeId,
    reason: ProfitRecomputeReason.MANUAL,
    orderIds,
  });
}
