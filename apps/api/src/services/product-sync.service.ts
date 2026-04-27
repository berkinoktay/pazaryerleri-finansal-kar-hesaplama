// Orchestrates one Trendyol product sync from start to finish:
//
//   • acquires a sync slot (sync_log row + race detection)
//   • iterates fetchApprovedProducts and upserts each batch in its own
//     transaction (so a crash mid-sync leaves earlier pages durable)
//   • marks variants that vanished from Trendyol's view as archived
//   • updates Store.lastSyncAt and SyncLog status when done
//
// The function is async-but-not-awaited by the route handler — it runs
// in the background of the Hono process via runInBackground(). The
// SyncLog row is the user-visible record of progress / outcome; this
// function never throws past its catch (errors live in the SyncLog).

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';

import { fetchApprovedProducts } from '../integrations/marketplace/trendyol/products';
import {
  isTrendyolCredentials,
  type MappedProduct,
} from '../integrations/marketplace/trendyol/types';
import { decryptCredentials } from '../lib/crypto';
import { ValidationError } from '../lib/errors';

import * as syncLogService from './sync-log.service';

interface RunOptions {
  store: Store;
  syncLogId: string;
}

export async function run({ store, syncLogId }: RunOptions): Promise<void> {
  const runStartedAt = new Date();
  let totalProcessed = 0;

  try {
    const credentials = decryptStoreCredentials(store);
    await syncLogService.advance(syncLogId, 0, null, 'fetching');

    for await (const { batch, pageMeta } of fetchApprovedProducts({
      environment: store.environment,
      credentials,
    })) {
      await upsertBatch(store, batch);
      totalProcessed += batch.length;
      await syncLogService.advance(syncLogId, totalProcessed, pageMeta.totalElements, 'upserting');
    }

    // Anything our DB has but the latest fetch didn't include is no
    // longer in Trendyol's approved set — soft-mark archived rather
    // than DELETE so OrderItem.productVariantId FKs remain valid.
    await prisma.productVariant.updateMany({
      where: {
        storeId: store.id,
        archived: false,
        lastSyncedAt: { lt: runStartedAt },
      },
      data: { archived: true },
    });

    await prisma.store.update({
      where: { id: store.id },
      data: { lastSyncAt: new Date() },
    });

    await syncLogService.complete(syncLogId, totalProcessed);
  } catch (err) {
    const errorCode = mapErrorToCode(err);
    const errorMessage = errorMessageFor(err);
    await syncLogService.fail(syncLogId, errorCode, errorMessage);
    console.error('[product-sync] failed', {
      storeId: store.id,
      syncLogId,
      errorCode,
      errorMessage,
    });
  }
}

function decryptStoreCredentials(
  store: Store,
): import('../integrations/marketplace/trendyol/types').TrendyolCredentials {
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    // Persisted credentials don't match the expected shape — data
    // corruption or a schema drift. Surface as a domain error so the
    // SyncLog records something actionable for ops.
    throw new ValidationError([{ field: 'credentials', code: 'INVALID_CREDENTIALS_SHAPE' }]);
  }
  return decrypted;
}

async function upsertBatch(store: Store, batch: MappedProduct[]): Promise<void> {
  // One transaction per content (parent + its variants + image replace).
  // Keeping transactions per-content rather than per-page bounds rollback
  // scope: a malformed single product won't roll back its 99 page-mates.
  for (const mapped of batch) {
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
  }
}

// Domain errors carry their stable code on the instance. Anything else
// collapses to INTERNAL_ERROR so we don't leak unhandled-error details
// into a SyncLog row that the frontend will surface to a seller.
function mapErrorToCode(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  return 'INTERNAL_ERROR';
}

function errorMessageFor(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
