// Catalog write path: the single source of truth for writing approved-products
// pages into Product and ProductVariant (spec 2026-06-12, PR-2 promotion). It
// used to live in apps/sync-worker/src/handlers/products.ts (with a "PORTED
// VERBATIM from apps/api/..." note) and was promoted to this package boundary
// when a third consumer, the webhook's eager catalog repair, appeared.
//
// Consumers:
//   - the sync-worker PRODUCTS full-scan handler (one approved page per chunk);
//   - the sync-worker PRODUCTS_CHANGES handler (one date-filtered approved page
//     per chunk);
//   - ensureBarcodesInCatalog (./ensure-barcodes.ts), the targeted barcode
//     repair, called by the sync-worker orders handler, the variant-resolution
//     tick and the webhook intake in
//     packages/webhook-ingest/src/trendyol-webhook-intake.ts.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { MappedProduct } from '@pazarsync/marketplace';
import { enqueueProfitRecomputeForVariants } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import { refreshProductAggregates } from './refresh-product-aggregates';

/**
 * True when a synced Decimal column moved to a different numeric value. Both
 * sides are the DB-boxed value (never the mapped input), so the comparison is
 * apples-to-apples: a non-null -> null transition, the reverse, or any value
 * change counts; two numerically equal values (e.g. 21 vs 21.00) do not.
 */
function syncedValueChanged(
  before: { toString(): string } | null,
  after: { toString(): string } | null,
): boolean {
  const b = before === null ? null : new Decimal(before.toString());
  const a = after === null ? null : new Decimal(after.toString());
  if (b === null) return a !== null;
  if (a === null) return true;
  return !b.equals(a);
}

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

        // Variants whose synced commission rate or dimensional weight actually
        // moved: those are backdated profit inputs, so their orders are queued
        // for a recompute below. The prior synced values are read once for the
        // whole content, in this same transaction, before the upserts, and each
        // variant compares its boxed before/after with decimal.js. A newly
        // inserted variant (no prior row) has no orders yet, so it is never
        // collected. (If a platformVariantId repeats inside one content, every
        // copy compares against the same pre-content value, which can only flag
        // the same or more changes, never fewer.)
        const platformVariantIds = Array.from(
          new Set(mapped.variants.map((variant) => variant.platformVariantId)),
        );
        const priorRows =
          platformVariantIds.length === 0
            ? []
            : await tx.productVariant.findMany({
                where: { storeId: store.id, platformVariantId: { in: platformVariantIds } },
                select: {
                  platformVariantId: true,
                  syncedCommissionRate: true,
                  syncedDimensionalWeight: true,
                },
              });
        const priorByPlatformVariantId = new Map(
          priorRows.map((row) => [row.platformVariantId, row]),
        );
        const changedVariantIds: string[] = [];

        for (const variant of mapped.variants) {
          const before = priorByPlatformVariantId.get(variant.platformVariantId) ?? null;

          const after = await tx.productVariant.upsert({
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
            // Neither the create nor the update clause may reference
            // `dimensionalWeightOverride`. That column is the user's override
            // and is sacred (see the ProductVariant schema comment): a new
            // variant starts with a null override, and sync writes only the
            // synced half of the pair.
            update: {
              // A variant returned by any approved-products page (full scan,
              // PRODUCTS_CHANGES, barcode repair) is, by definition, listed
              // again: clear the absence-from-feed stamp. (The create clause
              // needs nothing: delistedAt defaults to null.) Re-stamping stays
              // owned only by the full-scan handler, whose complete-done delist
              // pass stamps the variants that scan no longer returned.
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

          if (
            before !== null &&
            (syncedValueChanged(before.syncedCommissionRate, after.syncedCommissionRate) ||
              syncedValueChanged(before.syncedDimensionalWeight, after.syncedDimensionalWeight))
          ) {
            changedVariantIds.push(after.id);
          }
        }

        // Refresh the denormalized aggregates (totalStock + min/max sale price)
        // inside the same transaction, after the variant upserts above (no SQL
        // trigger: the sync code stays the single writer). They are re-read from
        // the DB rather than taken from this page, so they count only the
        // product's in-scope variants (listed and not archived) and stay
        // consistent for the products-list sort + salePrice filter.
        await refreshProductAggregates(tx, store.id, [product.id]);

        // A changed commission rate or desi is a backdated profit input: queue a
        // recompute for every order carrying one of these variants. The enqueue
        // is organization-filtered inside the same transaction, so no other
        // tenant's order is ever touched.
        if (changedVariantIds.length > 0) {
          await enqueueProfitRecomputeForVariants(tx, {
            organizationId: store.organizationId,
            variantIds: changedVariantIds,
            reason: ProfitRecomputeReason.REFERENCE_CHANGED,
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
