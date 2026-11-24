// Integration test: the catalog write path queues the non-final orders of the
// variants whose synced desi it changed (owner rule, Berkin 2026-11-23: an order's
// desi is the value in force at the end of its business day). Runs
// upsertCatalogBatch against the real database: the desi history trigger, the
// enqueue's non-final filter and its organization scope are all real. The call-level
// rules (which variants count as changed) are pinned by the package's mock-based
// unit test, packages/catalog-sync/src/__tests__/upsert-catalog-batch.test.ts.
//
// upsertCatalogBatch logs and skips a content whose transaction fails, so every case
// first asserts that the batch committed (the product title it writes landed).

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import { ProductVariantStatus, ProfitRecomputeReason } from '@pazarsync/db/enums';
import { upsertCatalogBatch } from '@pazarsync/catalog-sync';
import type { MappedProduct } from '@pazarsync/marketplace';

import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createOrder,
  createOrderItem,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { clearSellerInputHistory } from '../../../../apps/api/tests/helpers/seller-input-history';

const PLATFORM_CONTENT_ID = 880_001n;
const PLATFORM_VARIANT_ID = 880_101n;
const BARCODE = 'EAN13-CATALOG-DESI-001';
const SYNCED_TITLE = 'Catalog desi product (synced)';

interface CatalogFixture {
  readonly store: Store;
  readonly variantId: string;
}

/**
 * One store with one product and one variant carrying a synced desi of 2.00 and no
 * seller desi. The desi write is fixture setup, not history, so its log row is cleared.
 */
async function seedCatalog(): Promise<CatalogFixture> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const product = await createProduct(org.id, store.id, {
    platformContentId: PLATFORM_CONTENT_ID,
  });
  const variant = await createProductVariant(org.id, store.id, product.id, {
    barcode: BARCODE,
    platformVariantId: PLATFORM_VARIANT_ID,
  });
  await prisma.productVariant.update({
    where: { id: variant.id },
    data: { syncedDimensionalWeight: '2.00', dimensionalWeightOverride: null },
  });
  await clearSellerInputHistory(org.id);
  return { store, variantId: variant.id };
}

/** One order of the fixture's store carrying the variant, final or not. */
async function seedOrderOf(
  fixture: CatalogFixture,
  sellerInputsFinalAt: Date | null,
): Promise<string> {
  const order = await createOrder(fixture.store.organizationId, fixture.store.id, {
    sellerInputsFinalAt,
  });
  await createOrderItem(order.id, fixture.store.organizationId, {
    productVariantId: fixture.variantId,
  });
  return order.id;
}

/** The approved-products page content for the fixture's product, with the given desi. */
function mappedContent(syncedDimensionalWeight: string | null): MappedProduct {
  return {
    platformContentId: PLATFORM_CONTENT_ID,
    productMainId: 'PM-CATALOG-DESI',
    title: SYNCED_TITLE,
    description: null,
    brandId: null,
    brandName: null,
    categoryId: null,
    categoryName: null,
    color: null,
    attributes: [],
    platformCreatedAt: null,
    platformModifiedAt: null,
    imageUrls: [],
    variants: [
      {
        platformVariantId: PLATFORM_VARIANT_ID,
        barcode: BARCODE,
        stockCode: 'SC-CATALOG-DESI',
        salePrice: '100.00',
        listPrice: '120.00',
        vatRate: null,
        quantity: 5,
        deliveryDuration: null,
        productUrl: null,
        size: null,
        attributes: [],
        syncedDimensionalWeight,
        syncedCommissionRate: null,
        status: ProductVariantStatus.ON_SALE,
        statusReason: null,
      },
    ],
  };
}

/** Asserts the batch's content transaction committed: the synced title landed. */
async function expectBatchCommitted(store: Store): Promise<void> {
  const product = await prisma.product.findFirstOrThrow({
    where: {
      organizationId: store.organizationId,
      storeId: store.id,
      platformContentId: PLATFORM_CONTENT_ID,
    },
    select: { title: true },
  });
  expect(product.title).toBe(SYNCED_TITLE);
}

async function desiLogRows(store: Store, variantId: string) {
  return prisma.variantDesiChange.findMany({
    where: { organizationId: store.organizationId, productVariantId: variantId },
    orderBy: { seq: 'asc' },
  });
}

async function requestReason(orderId: string): Promise<ProfitRecomputeReason | undefined> {
  return (await prisma.profitRecomputeRequest.findUnique({ where: { orderId } }))?.reason;
}

describe('upsertCatalogBatch: a synced desi change queues the non-final orders', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('a changed synced desi is logged once and queues the non-final order only; an identical batch adds neither', async () => {
    const fixture = await seedCatalog();
    const nonFinalOrderId = await seedOrderOf(fixture, null);
    const finalOrderId = await seedOrderOf(fixture, new Date());

    await upsertCatalogBatch(fixture.store, [mappedContent('3.00')], null);

    await expectBatchCommitted(fixture.store);
    const logged = await desiLogRows(fixture.store, fixture.variantId);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.syncedChanged).toBe(true);
    expect(logged[0]?.newSynced?.toString()).toBe('3');
    expect(await requestReason(nonFinalOrderId)).toBe(ProfitRecomputeReason.DESI_CHANGED);
    expect(await requestReason(finalOrderId)).toBeUndefined();

    // The same batch again: no change, so no log row and no queue row. The mark is
    // removed first (the enqueue refreshes an existing row in place).
    await prisma.profitRecomputeRequest.deleteMany({
      where: { organizationId: fixture.store.organizationId },
    });
    await upsertCatalogBatch(fixture.store, [mappedContent('3.00')], null);

    expect(await desiLogRows(fixture.store, fixture.variantId)).toHaveLength(1);
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);
  });

  it('a batch that sends no desi (null) for a variant with a known synced desi changes nothing', async () => {
    const fixture = await seedCatalog();
    const nonFinalOrderId = await seedOrderOf(fixture, null);

    // Owner decision B2 (PR-0b): sync keeps the last known Trendyol desi.
    await upsertCatalogBatch(fixture.store, [mappedContent(null)], null);

    await expectBatchCommitted(fixture.store);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { syncedDimensionalWeight: true },
    });
    expect(variant.syncedDimensionalWeight?.toString()).toBe('2');
    expect(await desiLogRows(fixture.store, fixture.variantId)).toHaveLength(0);
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);

    // Positive control: a real new value is logged and queues the order.
    await upsertCatalogBatch(fixture.store, [mappedContent('3.00')], null);
    expect(await desiLogRows(fixture.store, fixture.variantId)).toHaveLength(1);
    expect(await requestReason(nonFinalOrderId)).toBe(ProfitRecomputeReason.DESI_CHANGED);
  });

  it("another organization's store with the same platformVariantId is neither changed nor queued", async () => {
    const own = await seedCatalog();
    const ownOrderId = await seedOrderOf(own, null);
    // Another tenant whose variant carries the same marketplace ids and the same desi,
    // with a non-final order of its own.
    const other = await seedCatalog();
    const otherOrderId = await seedOrderOf(other, null);

    await upsertCatalogBatch(own.store, [mappedContent('3.00')], null);

    await expectBatchCommitted(own.store);
    // Positive control: the caller's store is changed and queued.
    expect(await desiLogRows(own.store, own.variantId)).toHaveLength(1);
    expect(await requestReason(ownOrderId)).toBe(ProfitRecomputeReason.DESI_CHANGED);
    // The other tenant is untouched.
    const otherVariant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: other.variantId },
      select: { syncedDimensionalWeight: true },
    });
    expect(otherVariant.syncedDimensionalWeight?.toString()).toBe('2');
    expect(await desiLogRows(other.store, other.variantId)).toHaveLength(0);
    expect(await requestReason(otherOrderId)).toBeUndefined();
  });
});
