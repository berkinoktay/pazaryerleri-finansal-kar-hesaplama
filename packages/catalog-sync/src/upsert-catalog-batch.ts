// Katalog yazım hattı — tek doğruluk kaynağı (spec 2026-06-12 PR-2 terfisi).
// Eskiden apps/sync-worker/src/handlers/products.ts içindeydi ("PORTED VERBATIM
// from apps/api/..." notuyla); üçüncü tüketici (webhook eager onarımı) doğunca
// paket sınırına terfi etti. Tüketiciler: sync-worker products handler'ı,
// variant-resolution tick'i, apps/api webhook intake'i (ensureBarcodesInCatalog).

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import type { MappedProduct } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import { refreshProductAggregates } from './refresh-product-aggregates';

export async function upsertCatalogBatch(
  store: Store,
  batch: MappedProduct[],
  syncLogId: string | null,
): Promise<void> {
  // ─── PORTED VERBATIM from apps/api/src/services/product-sync.service.ts ──
  // One transaction per content (parent (incl. ordered imageUrls) + its variants).
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
            imageUrls: mapped.imageUrls,
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
            // Written on every re-sync, even when empty: Trendyol's ordered list
            // replaces the stored one (reordered, shrunk, or cleared).
            imageUrls: mapped.imageUrls,
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
              productUrl: variant.productUrl,
              size: variant.size,
              attributes: variant.attributes as never,
              syncedCommissionRate: variant.syncedCommissionRate,
              syncedDimensionalWeight: variant.syncedDimensionalWeight,
              status: variant.status,
              statusReason: variant.statusReason,
              lastSyncedAt: new Date(),
            },
            // The update clause MUST NOT reference `dimensionalWeight`.
            // That column is the user's override and is sacred — see the
            // ProductVariant schema comment. Sync writes only the synced
            // half of the pair.
            update: {
              // A variant returned by any full-scan page is, by definition,
              // listed again — clear the absence-from-feed stamp. (The create
              // clause needs nothing: delistedAt defaults to null.) The
              // full-scan handler re-stamps variants that this scan no longer
              // returned in its complete-done delist pass.
              delistedAt: null,
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              productUrl: variant.productUrl,
              size: variant.size,
              attributes: variant.attributes as never,
              syncedCommissionRate: variant.syncedCommissionRate,
              syncedDimensionalWeight: variant.syncedDimensionalWeight,
              status: variant.status,
              statusReason: variant.statusReason,
              lastSyncedAt: new Date(),
            },
          });
        }

        // Refresh the denormalized aggregates (totalStock + min/max sale price)
        // inside the same transaction, after the variant upserts above (no SQL
        // trigger: the sync code stays the single writer). They are re-read from
        // the DB rather than taken from this page, so they count only the
        // product's in-scope variants (listed and not archived) and stay
        // consistent for the products-list sort + salePrice filter.
        await refreshProductAggregates(tx, store.id, [product.id]);
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
