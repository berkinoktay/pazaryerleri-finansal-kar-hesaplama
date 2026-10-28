// Denormalized Product aggregates: totalStock, minSalePrice and maxSalePrice.
// They back the products-list sort (totalStock, salePrice) and the salePrice
// range filter, which read a column instead of aggregating the child relation.
//
// Callers: the catalog upsert (full scan and barcode repair, both through
// upsertCatalogBatch), the hourly stock+price delta, the delist pass and the
// order-intake stock decrement (@pazarsync/order-sync). The values are always
// recomputed from the DB and count only the variants in the default listing
// scope (LISTED_VARIANT_WHERE), so an archived or delisted variant never
// inflates a product's stock or price range. Callers pass their transaction so
// the refresh commits atomically with the variant writes that triggered it.
//
// Known gap: the confirmed price write in apps/api (price-write.service,
// reconcileSuccess) updates a variant's salePrice without calling this helper,
// so the price bounds can lag until the next delta or full scan.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

import { LISTED_VARIANT_WHERE } from './listing-scope';

// Pure aggregation over ONE product's in-scope variants, in a single pass.
// Sale-price bounds are null when the product has no in-scope variant (avoids a
// misleading 0.00). salePrice is a decimal string (the DB Decimal rendered with
// toString()) compared numerically through decimal.js; the bounds come back as
// 2-dp strings. Exported for unit testing.
export function computeProductAggregates(variants: { quantity: number; salePrice: string }[]): {
  totalStock: number;
  minSalePrice: string | null;
  maxSalePrice: string | null;
} {
  let totalStock = 0;
  let min: Decimal | null = null;
  let max: Decimal | null = null;
  for (const variant of variants) {
    totalStock += variant.quantity;
    const price = new Decimal(variant.salePrice);
    if (min === null || price.lt(min)) min = price;
    if (max === null || price.gt(max)) max = price;
  }
  return {
    totalStock,
    minSalePrice: min === null ? null : min.toFixed(2),
    maxSalePrice: max === null ? null : max.toFixed(2),
  };
}

/**
 * Recompute and write the aggregates of every product in `productIds` from its
 * in-scope variants: one read for all products, then one update per product.
 * A product left without any in-scope variant is still written (totalStock 0,
 * null price bounds); skipping it would freeze the stale totals of a product
 * whose last listed variant was just archived or delisted. Duplicate ids are
 * collapsed and an empty list is a no-op.
 *
 * Concurrency: the product rows are locked (FOR UPDATE, in id order) BEFORE the
 * variants are read. Under READ COMMITTED two writers that change different
 * variants of one product (an order intake and a delist chunk, say) could
 * otherwise each read the other's pre-commit state, and the later product
 * UPDATE would write totals from that stale read. With the lock taken first,
 * the second writer waits and then reads the first one's committed variants.
 * The fixed id order also keeps two multi-product refreshes from deadlocking
 * on each other's product rows.
 *
 * Tenant scope: the lock, the variant read and every update are filtered by
 * `storeId`. A product id from another store matches no row, so its update
 * throws (P2025) and rolls the caller's transaction back instead of rewriting
 * another tenant's totals.
 */
export async function refreshProductAggregates(
  tx: Prisma.TransactionClient,
  storeId: string,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const distinctIds = [...new Set(productIds)].sort();

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM products
    WHERE store_id = ${storeId}::uuid AND id = ANY(${distinctIds}::uuid[])
    ORDER BY id
    FOR UPDATE
  `;

  const variants = await tx.productVariant.findMany({
    where: { ...LISTED_VARIANT_WHERE, storeId, productId: { in: distinctIds } },
    select: { productId: true, quantity: true, salePrice: true },
  });

  const variantsByProduct = new Map<string, { quantity: number; salePrice: string }[]>();
  for (const variant of variants) {
    const group = variantsByProduct.get(variant.productId) ?? [];
    group.push({ quantity: variant.quantity, salePrice: variant.salePrice.toString() });
    variantsByProduct.set(variant.productId, group);
  }

  for (const productId of distinctIds) {
    await tx.product.update({
      where: { id: productId, storeId },
      data: computeProductAggregates(variantsByProduct.get(productId) ?? []),
      // The caller needs no row back; skip returning description and attributes.
      select: { id: true },
    });
  }
}
