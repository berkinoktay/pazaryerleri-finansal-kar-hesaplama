/**
 * Optimistic between-scans stock maintenance for the products surface.
 *
 * When an order line first enters the system we decrement the local variant
 * stock so the products list reflects the sale within seconds, instead of waiting
 * for the next catalog scan. "First enters" is either a direct first-insert into
 * `orders` (upsert-order.ts) OR a cost-missing-today order parking in the Live
 * Performance buffer (intake-order.ts) — the sale is real the moment the order
 * arrives (owner ruling 2026-07-11), so a buffered order drops stock immediately
 * and its later buffer→orders promotion does NOT decrement again. This is an
 * ESTIMATE only: any catalog
 * sync (the full metadata scan or the lightweight delta walk) overwrites
 * `product_variants.quantity` with the authoritative vendor value, so any drift
 * self-heals. Cancellations and returns deliberately do NOT re-add stock
 * (one-way simplicity — the scan reconciles). The single exception is the
 * split-dematerialize path, which reverses its own decrement (re-adds the
 * deleted ghost's line quantities) so the re-carried `createdBy="split"` child
 * packages decrement cleanly without double-counting. Owner-approved 2026-07-11.
 *
 * These helpers are package-internal on purpose — the public surface of
 * `@pazarsync/order-sync` stays the three intake/write symbols (see index.ts +
 * the exports guard test), and stock movement is an implementation detail of
 * the upsert/intake paths.
 */

import type { Prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import { getBusinessDate } from '@pazarsync/utils';

/**
 * Decrement one variant's stock by `quantity`, flooring at zero. Raw SQL because
 * Prisma cannot express `GREATEST(quantity - N, 0)` atomically. `updated_at` is
 * set explicitly: a raw UPDATE bypasses Prisma's `@updatedAt` and there is no DB
 * trigger for these tables (the sync worker is the single writer otherwise).
 */
export async function decrementVariantStock(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE product_variants
    SET quantity = GREATEST(quantity - ${quantity}::int, 0), updated_at = now()
    WHERE id = ${variantId}::uuid
  `;
}

/**
 * Re-add `quantity` to one variant's stock — the reverse of an optimistic
 * decrement, used only on the split-dematerialize path. No floor is needed
 * (re-adding only ever increases the count). If the original decrement had
 * floored at zero this reversal can transiently over-credit; the next catalog
 * scan overwrites with the authoritative value, so that estimate error is
 * self-healing (consistent with the estimate/scan-reconciles contract above).
 */
export async function incrementVariantStock(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE product_variants
    SET quantity = quantity + ${quantity}::int, updated_at = now()
    WHERE id = ${variantId}::uuid
  `;
}

/**
 * Recompute the denormalized `Product.totalStock` from `SUM(variants.quantity)`
 * for the given products, after their variant stock changed in this same
 * transaction. One grouped read plus one update per product — the distinct
 * product count for a single order is tiny. The Prisma update keeps `@updatedAt`
 * automatic; min/max sale prices are NOT a function of quantity, so they are
 * left untouched (only a catalog scan revises those).
 */
export async function recomputeProductsTotalStock(
  tx: Prisma.TransactionClient,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;

  const sums = await tx.productVariant.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { quantity: true },
  });

  for (const row of sums) {
    await tx.product.update({
      where: { id: row.productId },
      data: { totalStock: row._sum.quantity ?? 0 },
    });
  }
}

/**
 * Whether `orderDate` falls on the current business day — the shared gate for the
 * optimistic stock decrement. Used by BOTH the direct-persist path
 * (upsert-order.ts, first-insert lines) and the buffered-intake path
 * (intake-order.ts, cost-missing-today orders that park in the buffer) so the two
 * call sites decrement on exactly the same condition, from one implementation.
 *
 * Defensive by contract: `orderDate` is a real `Date` on the live sync / webhook
 * path, but an ISO STRING on the buffer-revived path — an order is reconstructed
 * from `live_performance_buffer.mapped_order` JSONB, and a JSON round-trip
 * serializes a `Date` into a string (the static `MappedOrder.orderDate: Date` type
 * does not reflect that runtime reality). `getBusinessDate` feeds its argument to
 * `Intl.DateTimeFormat.format`, which throws `RangeError: Invalid time value` on a
 * non-`Date`, so the value is normalized (`Date | string | number`) via
 * `new Date(...)` and NaN-checked BEFORE the format call — mirroring how the intake
 * paths coerce every other buffer-JSONB date.
 *
 * Any failure resolves to `false` (skip the decrement): the decrement is a
 * best-effort optimization and MUST never throw — a throw here would abort the
 * entire order persist / buffer insert inside the surrounding transaction. The
 * outer try/catch is a belt-and-suspenders guard on top of the NaN check so no
 * `Intl` edge case can escape; it logs rather than swallowing silently.
 */
export function isOrderOnBusinessToday(orderDate: Date | string | number): boolean {
  try {
    const parsed = new Date(orderDate);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }
    return getBusinessDate(parsed) === getBusinessDate();
  } catch (err) {
    syncLog.warn('stock.decrement-date-gate-skip', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
