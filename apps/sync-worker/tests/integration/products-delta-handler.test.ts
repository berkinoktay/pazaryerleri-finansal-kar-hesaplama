// Integration test for the chunked PRODUCTS_DELTA handler.
// One invocation = one Trendyol inventory-and-price page → in-memory diff →
// write only changed variants + re-aggregate the affected products.
// Reuses apps/api test helpers, same as products-handler.test.ts.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { encryptCredentials, syncLog } from '@pazarsync/sync-core';

import { processProductsChunk } from '../../src/handlers/products';
import { processProductsDeltaChunk } from '../../src/handlers/products-delta';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function createTestStore(
  orgId: string,
  opts?: { externalAccountId?: string; name?: string },
): Promise<{ storeId: string }> {
  const externalAccountId = opts?.externalAccountId ?? '2738';
  const store = await prisma.store.create({
    data: {
      organizationId: orgId,
      name: opts?.name ?? 'Test Trendyol Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId,
      credentials: encryptCredentials({
        supplierId: externalAccountId,
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });
  return { storeId: store.id };
}

// A minimal inventory-and-price page carrying one product with the given
// variants. Used by the token-continuation, reappearance, and two-store cases.
interface DeltaVariantSpec {
  variantId: number;
  quantity: number;
  salePrice: number;
  listPrice: number;
}

function inventoryPageOf(
  variants: DeltaVariantSpec[],
  meta: { totalElements: number; totalPages: number; page: number; nextPageToken: string | null },
): unknown {
  return {
    totalElements: meta.totalElements,
    totalPages: meta.totalPages,
    page: meta.page,
    size: 100,
    nextPageToken: meta.nextPageToken,
    content: [
      {
        contentId: 7001,
        productMainId: 'pm-7001',
        variants: variants.map((v) => ({
          variantId: v.variantId,
          barcode: `delta-bc-${v.variantId.toString()}`,
          salePrice: v.salePrice,
          listPrice: v.listPrice,
          quantity: v.quantity,
          stockCode: `delta-sk-${v.variantId.toString()}`,
          stockLastModifiedDate: null,
        })),
      },
    ],
  };
}

// A full-catalog approved page — seeds the catalog so the delta handler has
// variants to diff against. One content, two variants.
function approvedPage(): unknown {
  return {
    totalElements: 1,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: [
      {
        contentId: 7001,
        productMainId: 'pm-7001',
        brand: { id: 100, name: 'TestBrand' },
        category: { id: 200, name: 'TestCategory' },
        creationDate: 1777246115403,
        lastModifiedDate: 1777246115403,
        title: 'Delta Seed Product',
        description: 'desc',
        images: [{ url: 'https://cdn.example.com/7001.jpg' }],
        attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' }],
        variants: [
          {
            variantId: 70011,
            supplierId: 2738,
            barcode: 'delta-bc-1',
            attributes: [{ attributeId: 293, attributeName: 'Beden', attributeValue: 'M' }],
            onSale: true,
            deliveryOptions: { deliveryDuration: 1, isRushDelivery: true, fastDeliveryOptions: [] },
            stock: { quantity: 10, lastModifiedDate: 0 },
            price: { salePrice: 100, listPrice: 120 },
            stockCode: 'delta-sk-1',
            vatRate: 20,
            locked: false,
            archived: false,
            blacklisted: false,
          },
          {
            variantId: 70012,
            supplierId: 2738,
            barcode: 'delta-bc-2',
            attributes: [{ attributeId: 293, attributeName: 'Beden', attributeValue: 'L' }],
            onSale: true,
            deliveryOptions: { deliveryDuration: 1, isRushDelivery: true, fastDeliveryOptions: [] },
            stock: { quantity: 5, lastModifiedDate: 0 },
            price: { salePrice: 200, listPrice: 220 },
            stockCode: 'delta-sk-2',
            vatRate: 20,
            locked: false,
            archived: false,
            blacklisted: false,
          },
        ],
      },
    ],
  };
}

// An inventory-and-price page — the delta feed. Variant 70011 changed
// (quantity 10 -> 3, salePrice 100 -> 90), variant 70012 unchanged, and an
// unknown variant 88888 the catalog has never seen.
function inventoryDeltaPage(): unknown {
  return {
    totalElements: 1,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: [
      {
        contentId: 7001,
        productMainId: 'pm-7001',
        variants: [
          {
            variantId: 70011,
            barcode: 'delta-bc-1',
            salePrice: 90,
            listPrice: 120,
            quantity: 3,
            stockCode: 'delta-sk-1',
            stockLastModifiedDate: 1780463592464,
          },
          {
            variantId: 70012,
            barcode: 'delta-bc-2',
            salePrice: 200,
            listPrice: 220,
            quantity: 5,
            stockCode: 'delta-sk-2',
            stockLastModifiedDate: null,
          },
          {
            variantId: 88888,
            barcode: 'unknown-bc',
            salePrice: 5,
            listPrice: 5,
            quantity: 1,
            stockCode: 'unknown-sk',
            stockLastModifiedDate: null,
          },
        ],
      },
    ],
  };
}

async function seedCatalog(orgId: string, storeId: string): Promise<void> {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(approvedPage()));
  const seedLog = await prisma.syncLog.create({
    data: {
      organizationId: orgId,
      storeId,
      syncType: 'PRODUCTS',
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: 'worker-test',
      lastTickAt: new Date(),
      attemptCount: 1,
    },
  });
  await processProductsChunk({ syncLog: seedLog, cursor: null });
  await prisma.syncLog.update({
    where: { id: seedLog.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  vi.restoreAllMocks();
}

async function createDeltaLog(orgId: string, storeId: string) {
  return prisma.syncLog.create({
    data: {
      organizationId: orgId,
      storeId,
      syncType: 'PRODUCTS_DELTA',
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: 'worker-test',
      lastTickAt: new Date(),
      attemptCount: 1,
    },
  });
}

describe('processProductsDeltaChunk', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates only changed variants, recomputes aggregates, leaves unchanged rows and lastSyncedAt untouched, and skips unknown ids', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    await seedCatalog(org.id, storeId);

    const changed = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70011) },
    });
    const unchanged = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70012) },
    });
    const changedLastSyncedBefore = changed.lastSyncedAt;
    const unchangedUpdatedBefore = unchanged.updatedAt;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(inventoryDeltaPage()));
    const unknownInfoSpy = vi.spyOn(syncLog, 'info');

    const log = await createDeltaLog(org.id, storeId);
    const result = await processProductsDeltaChunk({ syncLog: log, cursor: null });

    expect(result.kind).toBe('done');

    // Changed variant: quantity + salePrice refreshed, listPrice unchanged value re-asserted.
    const changedAfter = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70011) },
    });
    expect(changedAfter.quantity).toBe(3);
    expect(changedAfter.salePrice.toString()).toBe('90');
    // lastSyncedAt is the FULL-scan marker — the delta handler must NOT touch it.
    expect(changedAfter.lastSyncedAt.getTime()).toBe(changedLastSyncedBefore.getTime());

    // Unchanged variant: no write at all (updatedAt stable).
    const unchangedAfter = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70012) },
    });
    expect(unchangedAfter.updatedAt.getTime()).toBe(unchangedUpdatedBefore.getTime());

    // Unknown variant never created.
    const unknown = await prisma.productVariant.findFirst({
      where: { storeId, platformVariantId: BigInt(88888) },
    });
    expect(unknown).toBeNull();
    expect(unknownInfoSpy).toHaveBeenCalledWith(
      'products-delta.unknown-variants',
      expect.objectContaining({ storeId, count: 1 }),
    );

    // Product aggregates recomputed: totalStock = 3 + 5 = 8, minSalePrice = 90.
    const product = await prisma.product.findFirstOrThrow({
      where: { storeId, platformContentId: BigInt(7001) },
    });
    expect(product.totalStock).toBe(8);
    expect(product.minSalePrice?.toString()).toBe('90');
    expect(product.maxSalePrice?.toString()).toBe('200');
  });

  it('warns on silent 10k-catalog truncation: past the page cap with no nextPageToken', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    const warnSpy = vi.spyOn(syncLog, 'warn');
    // Processing page 99 (items 9900-9999). Next page crosses the 10k cap and
    // no nextPageToken is returned → truncation warn, terminal done.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 20000,
        totalPages: 200,
        page: 99,
        size: 100,
        nextPageToken: null,
        content: [
          {
            contentId: 99001,
            productMainId: 'pm-99001',
            variants: [
              {
                variantId: 990010,
                barcode: 'cap-1',
                salePrice: 10,
                listPrice: 10,
                quantity: 1,
                stockCode: 'cap-sk-1',
                stockLastModifiedDate: null,
              },
            ],
          },
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS_DELTA',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 9900,
        progressTotal: 20000,
      },
    });

    const result = await processProductsDeltaChunk({
      syncLog: log,
      cursor: { kind: 'page', n: 99 },
    });

    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.finalCount).toBe(9901);
    expect(warnSpy).toHaveBeenCalledWith(
      'products-delta.catalog-truncated-10k',
      expect.objectContaining({ syncLogId: log.id, storeId, progress: 9901 }),
    );
  });

  it('above the 10k cap: a token cursor WITH a nextPageToken continues the token chain (never resets to page 0)', async () => {
    // Same collapse bug as the full products handler: a token cursor must NOT
    // fall back to page arithmetic. Past the cap the delta walk continues with
    // Trendyol's next token.
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        inventoryPageOf([{ variantId: 990010, quantity: 1, salePrice: 10, listPrice: 10 }], {
          totalElements: 20000,
          totalPages: 200,
          page: 100,
          nextPageToken: 'tok-next',
        }),
      ),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS_DELTA',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 10000,
        progressTotal: 20000,
      },
    });

    const result = await processProductsDeltaChunk({
      syncLog: log,
      cursor: { kind: 'token', token: 'tok-current' },
    });

    const firstArg = fetchSpy.mock.calls[0]?.[0];
    const url = typeof firstArg === 'string' ? firstArg : '';
    expect(url).toContain('nextPageToken=tok-current');
    expect(url).not.toContain('page=');

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.cursor).toEqual({ kind: 'token', token: 'tok-next' });
    expect(result.progress).toBe(10001);
  });

  it('above the 10k cap: a token cursor with NO nextPageToken ends as truncated done', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    const warnSpy = vi.spyOn(syncLog, 'warn');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        inventoryPageOf([{ variantId: 990010, quantity: 1, salePrice: 10, listPrice: 10 }], {
          totalElements: 20000,
          totalPages: 200,
          page: 100,
          nextPageToken: null,
        }),
      ),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS_DELTA',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 10000,
        progressTotal: 20000,
      },
    });

    const result = await processProductsDeltaChunk({
      syncLog: log,
      cursor: { kind: 'token', token: 'tok-current' },
    });

    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.finalCount).toBe(10001);
    expect(warnSpy).toHaveBeenCalledWith(
      'products-delta.catalog-truncated-10k',
      expect.objectContaining({ syncLogId: log.id, storeId, progress: 10001 }),
    );
  });

  it('clears a stale delistedAt on reappearance, even when quantity/prices are unchanged, without touching lastSyncedAt', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    await seedCatalog(org.id, storeId);

    // The full scan seeded 70011 (qty 10, sale 100, list 120). Simulate a prior
    // absence pass having delisted it.
    await prisma.productVariant.updateMany({
      where: { storeId, platformVariantId: BigInt(70011) },
      data: { delistedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const before = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70011) },
    });
    expect(before.delistedAt).not.toBeNull();
    const lastSyncedBefore = before.lastSyncedAt;

    // Delta feed returns 70011 with IDENTICAL stock/price — its presence alone is
    // proof of listing, so the row must be updated purely to clear delistedAt.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        inventoryPageOf([{ variantId: 70011, quantity: 10, salePrice: 100, listPrice: 120 }], {
          totalElements: 1,
          totalPages: 1,
          page: 0,
          nextPageToken: null,
        }),
      ),
    );

    const log = await createDeltaLog(org.id, storeId);
    const result = await processProductsDeltaChunk({ syncLog: log, cursor: null });
    expect(result.kind).toBe('done');

    const after = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70011) },
    });
    // delistedAt cleared by the reappearance.
    expect(after.delistedAt).toBeNull();
    // lastSyncedAt (full-scan marker) is NEVER touched by the delta handler.
    expect(after.lastSyncedAt.getTime()).toBe(lastSyncedBefore.getTime());
    // Stock/price unchanged.
    expect(after.quantity).toBe(10);
  });

  it('two stores sharing a platformVariantId: a delta run for store A mutates only A row', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId: storeA } = await createTestStore(org.id, { externalAccountId: '2738' });
    const { storeId: storeB } = await createTestStore(org.id, {
      externalAccountId: '9999',
      name: 'Store B',
    });

    // Both stores catalog the SAME platformVariantId 70011 (qty 10) in separate
    // rows — the isolation the delta handler must respect.
    await seedCatalog(org.id, storeA);
    await seedCatalog(org.id, storeB);

    // Delta for store A only: 70011 quantity 10 -> 3.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        inventoryPageOf([{ variantId: 70011, quantity: 3, salePrice: 100, listPrice: 120 }], {
          totalElements: 1,
          totalPages: 1,
          page: 0,
          nextPageToken: null,
        }),
      ),
    );

    const log = await createDeltaLog(org.id, storeA);
    const result = await processProductsDeltaChunk({ syncLog: log, cursor: null });
    expect(result.kind).toBe('done');

    const aRow = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: storeA, platformVariantId: BigInt(70011) },
    });
    const bRow = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: storeB, platformVariantId: BigInt(70011) },
    });
    // Store A mutated.
    expect(aRow.quantity).toBe(3);
    // Store B untouched — same platformVariantId, different tenant-scoped row.
    expect(bRow.quantity).toBe(10);
  });
});
