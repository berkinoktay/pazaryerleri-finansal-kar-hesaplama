/**
 * Optimistic between-scans stock maintenance for the products surface.
 *
 * When an order line is persisted for the FIRST time we decrement the local
 * variant stock so the products list reflects the sale within seconds, instead
 * of waiting for the next catalog scan. This is an ESTIMATE only: any catalog
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
