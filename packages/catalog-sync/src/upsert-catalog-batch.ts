// Katalog yazım hattı — tek doğruluk kaynağı (spec 2026-06-12 PR-2 terfisi).
// Eskiden apps/sync-worker/src/handlers/products.ts içindeydi ("PORTED VERBATIM
// from apps/api/..." notuyla); üçüncü tüketici (webhook eager onarımı) doğunca
// paket sınırına terfi etti. Tüketiciler: sync-worker products handler'ı,
// variant-resolution tick'i, apps/api webhook intake'i (ensureBarcodesInCatalog).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import type { MappedProduct } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

// The denormalized aggregates Product carries for the products-list workflows:
// totalStock (sort + restock review) and min/maxSalePrice (sort=salePrice + the
// salePrice range filter, which read a column instead of aggregating the child
// relation). Computed in a single pass so the sync hot path touches each
// variant once. Sale-price bounds are null for a content with no variants
// (avoids a misleading 0.00); mapped salePrice is always a 2-dp decimal string
// (marketplace mapper `priceToDecimalString`). Pure + exported for unit testing.
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

export async function upsertCatalogBatch(
  store: Store,
  batch: MappedProduct[],
  syncLogId: string | null,
): Promise<void> {
  // ─── PORTED VERBATIM from apps/api/src/services/product-sync.service.ts ──
  // One transaction per content (parent + its variants + image replace).
  // Each content also runs inside a try/catch — a single malformed
  // product (rare, but real Trendyol data has shipped duplicate
  // barcodes within a store, missing required fields, etc.) gets
  // logged and skipped so the sync completes for every other product
  // in the page. The aggregate count of failures becomes a follow-up
  // observability concern; for now `[product-sync] content-upsert
  // failed` shows up in the ops logs with the contentId.
  for (const mapped of batch) {
    try {
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.upsert({
          where: {
            storeId_platformContentId: {
              storeId: store.id,
              platformContentId: mapped.platformContentId,
            },
          },
          create: {
            organizationId: store.organizationId,
            storeId: store.id,
            platformContentId: mapped.platformContentId,
            productMainId: mapped.productMainId,
            title: mapped.title,
            description: mapped.description,
            brandId: mapped.brandId,
            brandName: mapped.brandName,
            categoryId: mapped.categoryId,
            categoryName: mapped.categoryName,
            color: mapped.color,
            attributes: mapped.attributes as never,
            platformCreatedAt: mapped.platformCreatedAt,
            platformModifiedAt: mapped.platformModifiedAt,
            lastSyncedAt: new Date(),
          },
          update: {
            productMainId: mapped.productMainId,
            title: mapped.title,
            description: mapped.description,
            brandId: mapped.brandId,
            brandName: mapped.brandName,
            categoryId: mapped.categoryId,
            categoryName: mapped.categoryName,
            color: mapped.color,
            attributes: mapped.attributes as never,
            platformCreatedAt: mapped.platformCreatedAt,
            platformModifiedAt: mapped.platformModifiedAt,
            lastSyncedAt: new Date(),
          },
        });

        for (const variant of mapped.variants) {
          await tx.productVariant.upsert({
            where: {
              storeId_platformVariantId: {
                storeId: store.id,
                platformVariantId: variant.platformVariantId,
              },
            },
            create: {
              organizationId: store.organizationId,
              storeId: store.id,
              productId: product.id,
              platformVariantId: variant.platformVariantId,
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              isRushDelivery: variant.isRushDelivery,
              fastDeliveryOptions: variant.fastDeliveryOptions as never,
              productUrl: variant.productUrl,
              locationBasedDelivery: variant.locationBasedDelivery,
              onSale: variant.onSale,
              archived: variant.archived,
              blacklisted: variant.blacklisted,
              locked: variant.locked,
              size: variant.size,
              attributes: variant.attributes as never,
              syncedDimensionalWeight: variant.syncedDimensionalWeight,
              lastSyncedAt: new Date(),
            },
            // The update clause MUST NOT reference `dimensionalWeight`.
            // That column is the user's override and is sacred — see the
            // ProductVariant schema comment. Sync writes only the synced
            // half of the pair.
            update: {
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              isRushDelivery: variant.isRushDelivery,
              fastDeliveryOptions: variant.fastDeliveryOptions as never,
              productUrl: variant.productUrl,
              locationBasedDelivery: variant.locationBasedDelivery,
              onSale: variant.onSale,
              archived: variant.archived,
              blacklisted: variant.blacklisted,
              locked: variant.locked,
              size: variant.size,
              attributes: variant.attributes as never,
              syncedDimensionalWeight: variant.syncedDimensionalWeight,
              lastSyncedAt: new Date(),
            },
          });
        }

        // Recompute the denormalized aggregates (totalStock + min/max sale
        // price) from the variants we just upserted. We do this inside the same
        // transaction (rather than a SQL trigger) so the sync worker remains the
        // single source of truth for product mutations and the values are
        // immediately consistent for the products-list sort + salePrice filter.
        const { totalStock, minSalePrice, maxSalePrice } = computeProductAggregates(
          mapped.variants,
        );
        await tx.product.update({
          where: { id: product.id },
          data: { totalStock, minSalePrice, maxSalePrice },
        });

        // Replace images for this product. ProductImage rows have no
        // per-image identifier we can match against (Trendyol gives an
        // ordered URL list), so the cleanest semantic is "this is the
        // new ordered set, drop the previous set".
        await tx.productImage.deleteMany({ where: { productId: product.id } });
        if (mapped.images.length > 0) {
          await tx.productImage.createMany({
            data: mapped.images.map((img) => ({
              organizationId: store.organizationId,
              productId: product.id,
              url: img.url,
              position: img.position,
            })),
          });
        }
      });
    } catch (err) {
      syncLog.error('content.upsert.failed', {
        ...(syncLogId !== null && { syncLogId }),
        storeId: store.id,
        platformContentId: mapped.platformContentId.toString(),
        productMainId: mapped.productMainId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Skip and continue — one bad content cannot abort the run.
    }
  }
}
