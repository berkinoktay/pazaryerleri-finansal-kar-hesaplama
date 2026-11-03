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
