import type { Prisma } from '@pazarsync/db';

/**
 * The variant an order line names: the first variant of `barcode` inside the
 * organization's store, in variant-id order (the lowest id).
 *
 * `(storeId, barcode)` is non-unique by design, so a barcode may match several
 * variants. Every order-line resolver goes through this one function so they all
 * name the same variant, the one the calculability gate (`buildCalcCheckLines`)
 * checks: the order item link in `upsert-order.ts`, the buffered stock decrement and
 * the buffered-ghost restock in `intake-order.ts`, and the late link in the
 * sync-worker's `variant-resolution.ts`.
 *
 * Tenant scope: the lookup filters on BOTH `organizationId` and `storeId`
 * (SECURITY.md), so a store id of another organization, or a variant row of this
 * store stamped with another organization, never resolves.
 *
 * Accepts the Prisma client OR an interactive-transaction client.
 */
export async function findFirstVariantByBarcode(
  db: Prisma.TransactionClient,
  args: { organizationId: string; storeId: string; barcode: string },
): Promise<{ id: string; productId: string } | null> {
  return db.productVariant.findFirst({
    where: {
      organizationId: args.organizationId,
      storeId: args.storeId,
      barcode: args.barcode,
    },
    orderBy: { id: 'asc' },
    select: { id: true, productId: true },
  });
}
