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
import type { Prisma, Store } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { MappedProduct, MappedProductVariant } from '@pazarsync/marketplace';
import { enqueueProfitRecomputeForVariants } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';
import { SELLER_INPUT_TX_OPTIONS } from '@pazarsync/utils';

import { refreshProductAggregates } from './refresh-product-aggregates';

/** A stored variant's synced desi, read before the batch overwrites it. */
interface StoredSyncedDesi {
  readonly id: string;
  readonly syncedDimensionalWeight: Prisma.Decimal | null;
}

/**
 * Reads the stored synced desi of this store's variants that the content names, keyed
 * by platformVariantId. Runs right after the product upsert, whose row lock serialises
 * two syncs of one content, so the values read are the ones the variant upserts below
 * overwrite. Tenant scope: organization and store.
 */
async function readStoredSyncedDesi(
  tx: Prisma.TransactionClient,
  store: Store,
  variants: readonly MappedProductVariant[],
): Promise<Map<bigint, StoredSyncedDesi>> {
  const rows = await tx.productVariant.findMany({
    where: {
      organizationId: store.organizationId,
      storeId: store.id,
      platformVariantId: { in: variants.map((variant) => variant.platformVariantId) },
    },
    select: { id: true, platformVariantId: true, syncedDimensionalWeight: true },
  });
  return new Map(
    rows.map((row) => [
      row.platformVariantId,
      { id: row.id, syncedDimensionalWeight: row.syncedDimensionalWeight },
    ]),
  );
}

/**
 * The ids of the pre-existing variants whose synced desi this content changes: the
 * mapped desi is a value and it differs from the stored one (a Decimal comparison, so
 * 2.00 equals a stored 2; a stored null that gets a value is a change). A null mapped
 * desi is never a change, because the update keeps the stored synced desi then (owner
 * rule B2, PR-0b). A variant the content creates is not counted: no captured order
 * item can reference it yet.
 */
function changedSyncedDesiVariantIds(
  variants: readonly MappedProductVariant[],
  stored: ReadonlyMap<bigint, StoredSyncedDesi>,
): string[] {
  const changed = new Set<string>();
  for (const variant of variants) {
    const mapped = variant.syncedDimensionalWeight;
    const before = stored.get(variant.platformVariantId);
    if (mapped === null || before === undefined) continue;
    const storedDesi = before.syncedDimensionalWeight;
    if (storedDesi === null || !new Decimal(mapped).equals(storedDesi.toString())) {
      changed.add(before.id);
    }
  }
  return [...changed];
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
  //
  // A content transaction can stamp seller-input history (a synced desi change row,
  // written by the variant trigger), so it runs with SELLER_INPUT_TX_OPTIONS: its short
  // timeout keeps a write stamped before a business-day end from committing after that
  // day is settled (same-day edit window, D6).
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

        // A changed synced commission rate reaches only new orders and the catalog
        // estimate: a stored order keeps the rate captured at intake. A changed
        // synced desi also reaches the stored orders whose seller inputs are not
        // final yet (owner rule, Berkin 2026-11-23: an order's desi is the value in
        // force at the end of its business day), so the variants it changed are
        // queued below. The stored values are read before the upserts overwrite them.
        const storedDesi = await readStoredSyncedDesi(tx, store, mapped.variants);

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
              // Owner rule (Berkin 2026-11-23): sync never erases a known
              // Trendyol desi. A null mapped desi (Trendyol sent 0 or nothing)
              // leaves the stored value as it is; a real value replaces it. The
              // create clause above still writes null for a new variant.
              ...(variant.syncedDimensionalWeight !== null && {
                syncedDimensionalWeight: variant.syncedDimensionalWeight,
              }),
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

        // Once per content, at the end of its transaction: the non-final orders of
        // the variants whose synced desi this content changed (DESI_CHANGED). The
        // enqueue is organization-scoped and the ids are this store's own variants.
        const desiChangedVariantIds = changedSyncedDesiVariantIds(mapped.variants, storedDesi);
        if (desiChangedVariantIds.length > 0) {
          await enqueueProfitRecomputeForVariants(tx, {
            organizationId: store.organizationId,
            variantIds: desiChangedVariantIds,
            reason: ProfitRecomputeReason.DESI_CHANGED,
          });
        }
      }, SELLER_INPUT_TX_OPTIONS);
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
