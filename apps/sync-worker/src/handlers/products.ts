// Trendyol products module handler — one chunk = one Trendyol page.
//
// Compared to the legacy `apps/api/src/services/product-sync.service.ts` which
// streams every page of a sync inside a single async-but-not-awaited function,
// this handler processes ONE page per invocation and returns a cursor the
// dispatcher writes to `SyncLog.pageCursor`. The next chunk picks up exactly
// where this one stopped, so a crash or a redeploy mid-sync loses at most one
// page of work and never re-runs already-upserted pages.
//
// `upsertBatch` is ported verbatim from the legacy service (per-content
// transaction + try/catch + image replace semantics) — PR 4h will delete the
// original; this port preserves behavior bit-for-bit.

import { prisma } from '@pazarsync/db';
import type { Store, SyncLog } from '@pazarsync/db';
import {
  fetchApprovedProducts,
  isTrendyolCredentials,
  type MappedProduct,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import {
  decryptCredentials,
  parseProductsCursor,
  syncLog,
  type ProductsCursor,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

export async function processProductsChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const cursor = parseProductsCursor(input.cursor);
  syncLog.info('chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor: input.cursor,
    progressCurrent: log.progressCurrent,
  });
  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields the FIRST page, then we return — the dispatcher loops
  // back through the queue with our cursor for the next page.
  const generator = fetchApprovedProducts({
    environment: store.environment,
    credentials,
    initialCursor: cursor,
  });
  const { value, done } = await generator.next();

  // Trendyol returned no more content (empty content[]) — sync is complete.
  if (done === true || value === undefined) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  await upsertBatch(store, batch, log.id);

  const newProgress = log.progressCurrent + batch.length;

  // Cursor advances: prefer Trendyol's own nextPageToken when present
  // (it returns one past the 10k page-cap, and may for non-cap'd pages
  // too — using it is always correct). Otherwise increment the page index.
  let nextCursor: ProductsCursor;
  if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
    nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
  } else {
    const currentN = cursor === null ? 0 : cursor.kind === 'page' ? cursor.n : 0;
    nextCursor = { kind: 'page', n: currentN + 1 };
  }

  if (newProgress >= pageMeta.totalElements) {
    return { kind: 'done', finalCount: newProgress };
  }

  syncLog.info('chunk.complete', {
    syncLogId: log.id,
    pageBatchSize: batch.length,
    newProgress,
    totalElements: pageMeta.totalElements,
    nextCursor,
  });

  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: pageMeta.totalElements,
    stage: 'upserting',
  };
}

export const productsHandler: ModuleHandler = { processChunk: processProductsChunk };

function decryptStoreCredentials(store: Store): TrendyolCredentials {
  // Prisma's Json column type is `JsonValue`, not `string`; the actual
  // runtime value here is the AES-256-GCM ciphertext base64 blob. The
  // `as string` matches the existing pattern in the legacy service —
  // the documented Prisma JSON exception to the no-`as` rule.
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new Error('Invalid Trendyol credentials shape on store');
  }
  return decrypted;
}

async function upsertBatch(store: Store, batch: MappedProduct[], syncLogId: string): Promise<void> {
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
              lastSyncedAt: new Date(),
            },
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
              lastSyncedAt: new Date(),
            },
          });
        }

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
        syncLogId,
        storeId: store.id,
        platformContentId: mapped.platformContentId.toString(),
        productMainId: mapped.productMainId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Skip and continue — one bad content cannot abort the run.
    }
  }
}
