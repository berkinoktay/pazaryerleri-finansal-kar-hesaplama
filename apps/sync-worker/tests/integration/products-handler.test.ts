// Integration test for the chunked products handler.
// One invocation = one Trendyol page → upsert → return cursor or 'done'.
// Reuses apps/api test helpers — apps/sync-worker has no factories of its own
// yet (same pattern as packages/sync-core's claim/checkpoint integration tests).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';
import { encryptCredentials, LostLeaseError, syncLog } from '@pazarsync/sync-core';

import { processProductsChunk } from '../../src/handlers/products';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

interface ContentSpec {
  contentId: number;
  productMainId: string;
  title: string;
  variants: VariantSpec[];
  // Wire image urls in Trendyol order; omitted = one image named after the contentId.
  imageUrls?: string[];
}

interface VariantSpec {
  variantId: number;
  barcode: string;
  stockCode: string;
  size?: string;
  salePrice?: number;
  quantity?: number;
  dimensionalWeight?: number;
  // Wire status flags; omitted ones keep the on-sale defaults in buildContent.
  onSale?: boolean;
  locked?: boolean;
  lockReason?: string | null;
  archived?: boolean;
}

function buildContent(spec: ContentSpec): unknown {
  return {
    contentId: spec.contentId,
    productMainId: spec.productMainId,
    brand: { id: 100, name: 'TestBrand' },
    category: { id: 200, name: 'TestCategory' },
    creationDate: 1777246115403,
    lastModifiedDate: 1777246115403,
    title: spec.title,
    description: 'desc',
    images: (spec.imageUrls ?? [`https://cdn.example.com/${spec.contentId.toString()}.jpg`]).map(
      (url) => ({ url }),
    ),
    attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' }],
    variants: spec.variants.map((v) => ({
      variantId: v.variantId,
      supplierId: 2738,
      barcode: v.barcode,
      attributes:
        v.size !== undefined
          ? [{ attributeId: 293, attributeName: 'Beden', attributeValue: v.size }]
          : [],
      onSale: v.onSale ?? true,
      deliveryOptions: { deliveryDuration: 1 },
      stock: { quantity: v.quantity ?? 10, lastModifiedDate: 0 },
      price: { salePrice: v.salePrice ?? 100, listPrice: v.salePrice ?? 100 },
      stockCode: v.stockCode,
      vatRate: 20,
      locked: v.locked ?? false,
      ...(v.lockReason !== undefined ? { lockReason: v.lockReason } : {}),
      archived: v.archived ?? false,
      blacklisted: false,
      ...(v.dimensionalWeight !== undefined ? { dimensionalWeight: v.dimensionalWeight } : {}),
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function createTestStore(orgId: string): Promise<{ storeId: string }> {
  const store = await prisma.store.create({
    data: {
      organizationId: orgId,
      name: 'Test Trendyol Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '2738',
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });
  return { storeId: store.id };
}

// Seed a product + one variant directly, bypassing the scan. Used by the
// delist-by-absence tests to plant a row with a chosen lastSyncedAt (older than
// the scan's startedAt = "not returned by this scan"), an optional existing
// delistedAt stamp, and optional stock/price for the aggregate assertions.
async function seedVariant(
  orgId: string,
  storeId: string,
  opts: {
    contentId: number;
    variantId: number;
    lastSyncedAt: Date;
    delistedAt?: Date | null;
    quantity?: number;
    salePrice?: string;
  },
): Promise<{ variantDbId: string; productId: string }> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(opts.contentId),
      productMainId: `seed-pm-${opts.contentId.toString()}`,
      title: `Seed Product ${opts.contentId.toString()}`,
      lastSyncedAt: opts.lastSyncedAt,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(opts.variantId),
      barcode: `seed-bc-${opts.variantId.toString()}`,
      stockCode: `seed-sk-${opts.variantId.toString()}`,
      salePrice: opts.salePrice ?? '100.00',
      listPrice: opts.salePrice ?? '100.00',
      quantity: opts.quantity ?? 0,
      lastSyncedAt: opts.lastSyncedAt,
      delistedAt: opts.delistedAt ?? null,
    },
  });
  return { variantDbId: variant.id, productId: product.id };
}

// A date safely before any scan's startedAt (= "the last full scan that touched
// this variant predates the current one" = absent from the current scan).
const STALE_LAST_SYNCED_AT = new Date('2020-01-01T00:00:00.000Z');

// Mirrors DELIST_CHUNK_SIZE in apps/sync-worker/src/handlers/products.ts (not
// exported): the delist pass stamps and re-aggregates its candidates in chunks
// of this many variants. The multi-chunk test seeds one candidate more than this.
const DELIST_CHUNK_SIZE = 200;

describe('processProductsChunk', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes one Trendyol page: upserts products, returns cursor for next page', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Trendyol returns 200 total elements split across 2 pages of 100.
    // We're processing page 0, which has one content item (1 record);
    // the handler should report progress=1, total=200 and a cursor for page 1.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 200,
        totalPages: 2,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 5001,
            productMainId: 'pm-5001',
            title: 'Chunk Product One',
            variants: [{ variantId: 50010, barcode: 'cb-1', stockCode: 'csk-1', size: 'M' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.progress).toBe(1);
    expect(result.total).toBe(200);
    expect(result.stage).toBe('upserting');
    expect(result.cursor).toEqual({ kind: 'page', n: 1 });

    const products = await prisma.product.findMany({ where: { storeId } });
    expect(products).toHaveLength(1);
    expect(products[0]?.imageUrls).toEqual(['https://cdn.example.com/5001.jpg']);
  });

  it('returns kind=done when totalElements is reached', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Resuming at page 1 of a 100-element / 1-page sync — Trendyol
    // returns an empty content[] (catalog exhausted), and the handler
    // signals completion to the dispatcher.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 100,
        totalPages: 1,
        page: 1,
        size: 100,
        nextPageToken: null,
        content: [],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 100,
        progressTotal: 100,
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      cursor: { kind: 'page', n: 1 },
      workerId: 'worker-test',
    });

    expect(result.kind).toBe('done');
  });

  it('returns kind=done after the LAST documented page even if newProgress < totalElements (skipped-page case)', async () => {
    // Real-world scenario from the dev sandbox sync (5,590-product
    // catalog, 56 pages). The worker's skip-bad-page recovery dropped
    // page 24 mid-stream, so newProgress lags totalElements by 100
    // (the skipped page's items never landed). Without the
    // totalPages-aware exit, the chunk handler returns `kind: 'continue'`
    // after page 55, the dispatcher then walks pages 56, 57, 58, ...
    // — Trendyol 404s every out-of-range request, skip-bad-page
    // advances the cursor +1 each time, and the run never terminates.
    //
    // After this test's enforcing fix, processing page 55 (cursor.n=55,
    // totalPages=56 → justProcessedPage === totalPages - 1) returns
    // DONE even though newProgress (5490) is still under totalElements
    // (5590).
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 5590,
        totalPages: 56,
        page: 55,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 55001,
            productMainId: 'pm-55001',
            title: 'Last Page Product',
            variants: [{ variantId: 550010, barcode: 'lpb-1', stockCode: 'lps-1', size: 'M' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 5489, // just under totalElements after a skipped page earlier
        progressTotal: 5590,
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      cursor: { kind: 'page', n: 55 },
      workerId: 'worker-test',
    });

    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.finalCount).toBe(5490); // 5489 + 1 from this last page's batch
  });

  it('warns on silent 10k-catalog truncation: past the page cap with no nextPageToken', async () => {
    // Trendyol paginates ?page=N&size=100 only while page*size <= 10,000; item
    // 10,000+ needs a nextPageToken the vendor sometimes never returns. When
    // the next page would cross the cap AND no token was provided, the tail of
    // the catalog is unreachable. The handler still returns `done`, but that
    // used to look identical to a clean completion — it now emits a warn so a
    // catalog quietly capped at 10k items is observable in the logs.
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Processing page 99 (items 9900-9999). The next page (100) would cross the
    // 10k cap, and totalElements (20000) / totalPages (200) sit well beyond it,
    // so neither the totalElements nor the last-documented-page exit fires — we
    // land squarely in the past-cap-without-token branch.
    const warnSpy = vi.spyOn(syncLog, 'warn');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 20000,
        totalPages: 200,
        page: 99,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 99001,
            productMainId: 'pm-99001',
            title: 'Cap Boundary Product',
            variants: [{ variantId: 990010, barcode: 'cap-1', stockCode: 'cap-sk-1', size: 'M' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: { kind: 'page', n: 99 },
      workerId: 'worker-test',
    });

    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.finalCount).toBe(9901); // 9900 + this page's single item

    expect(warnSpy).toHaveBeenCalledWith(
      'products.catalog-truncated-10k',
      expect.objectContaining({ syncLogId: log.id, storeId, progress: 9901 }),
    );
  });

  it('falls back from a saved token cursor to page-based when below the 10k cap', async () => {
    // The chunk handler converts a saved token cursor to a page cursor
    // when progressCurrent is under the 10k cap, because that's where
    // page-based pagination is the documented contract and tokens have
    // been observed to 500 deterministically. progressCurrent=2400 →
    // page index 24; the next request should hit page=24, NOT use the
    // saved (potentially poisoned) token.
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 5624,
        totalPages: 57,
        page: 24,
        size: 100,
        // Trendyol still returns a token; the handler should ignore it
        // because we're below the cap.
        nextPageToken: 'eyJzb3J0IjpbMTc2MDk2MTM2NzAwMF19',
        content: [
          buildContent({
            contentId: 24001,
            productMainId: 'pm-24001',
            title: 'Recovered Product',
            variants: [{ variantId: 240010, barcode: 'rb-1', stockCode: 'rs-1', size: 'M' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 2,
        progressCurrent: 2400,
        progressTotal: 5624,
        pageCursor: { kind: 'token', token: 'poisoned-token' } as never,
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      // Simulate the dispatcher reading SyncLog.pageCursor.
      cursor: { kind: 'token', token: 'poisoned-token' },
      workerId: 'worker-test',
    });

    // The fetch URL must be page-based at index 24 (= 2400 / 100), not
    // a request carrying the poisoned token.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain('page=24');
    expect(url).not.toContain('nextPageToken');

    // Result advances to page=25 — also page-based, because the next
    // page (2500–2599) still sits well below the cap.
    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.cursor).toEqual({ kind: 'page', n: 25 });
    expect(result.progress).toBe(2401);
  });

  it('upserts Product with totalStock equal to sum of variant quantities', async () => {
    // Denormalized total_stock column is updated transactionally inside
    // upsertBatch (sync worker is the single source of truth for product
    // mutations, so totalStock stays immediately consistent for the
    // products-list sort=totalStock workflow).
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 900_001,
            productMainId: 'TS-TOTALSTOCK-1',
            title: 'TotalStock Sum Product',
            variants: [
              { variantId: 900_101, barcode: 'ts-bc-1', stockCode: 'ts-sk-1', quantity: 7 },
              { variantId: 900_102, barcode: 'ts-bc-2', stockCode: 'ts-sk-2', quantity: 13 },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });

    const product = await prisma.product.findFirstOrThrow({
      where: { storeId, platformContentId: BigInt(900_001) },
    });
    expect(product.totalStock).toBe(20);
  });

  it('upserts Product with min/maxSalePrice spanning the variant sale prices', async () => {
    // Denormalized min_sale_price / max_sale_price are written transactionally
    // in the same upsertBatch update as total_stock — they back the
    // products-list sort=salePrice and the salePrice range filter (PR-B1).
    // Prisma's Decimal.toString() strips trailing zeros (89.50 → "89.5").
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 910_001,
            productMainId: 'TS-SALEPRICE-1',
            title: 'SalePrice Bounds Product',
            variants: [
              { variantId: 910_101, barcode: 'sp-bc-1', stockCode: 'sp-sk-1', salePrice: 89.5 },
              { variantId: 910_102, barcode: 'sp-bc-2', stockCode: 'sp-sk-2', salePrice: 249.9 },
              { variantId: 910_103, barcode: 'sp-bc-3', stockCode: 'sp-sk-3', salePrice: 129.0 },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });

    const product = await prisma.product.findFirstOrThrow({
      where: { storeId, platformContentId: BigInt(910_001) },
    });
    expect(product.minSalePrice?.toString()).toBe('89.5');
    expect(product.maxSalePrice?.toString()).toBe('249.9');
  });

  it('seeds syncedDimensionalWeight from Trendyol response on first sync, leaving user override null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 800_001,
            productMainId: 'TS-DESI-1',
            title: 'Desi Seed Product',
            variants: [
              {
                variantId: 800_101,
                barcode: 'desi-bc-1',
                stockCode: 'desi-sk-1',
                dimensionalWeight: 1.5,
              },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(800_101) },
    });
    expect(variant.syncedDimensionalWeight?.toString()).toBe('1.5');
    expect(variant.dimensionalWeight).toBeNull();
  });

  it('LOAD-BEARING: re-sync never overwrites the user override (dimensionalWeight column is sacred)', async () => {
    // This is the test that proves the two-column architecture works.
    // If this ever fails, somebody has reintroduced a write to
    // ProductVariant.dimensional_weight from the sync handler — that path
    // must never exist.
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Seed: first sync brings Trendyol's value (1.0), no user override yet.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 800_002,
            productMainId: 'TS-DESI-2',
            title: 'Desi Override Survives',
            variants: [
              {
                variantId: 800_102,
                barcode: 'desi-bc-2',
                stockCode: 'desi-sk-2',
                dimensionalWeight: 1.0,
              },
            ],
          }),
        ],
      }),
    );
    const log1 = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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
    await processProductsChunk({ syncLog: log1, cursor: null, workerId: 'worker-test' });

    // Mark log1 as completed so the (store_id, sync_type) active-sync
    // uniqueness constraint allows log2 to be created.
    await prisma.syncLog.update({
      where: { id: log1.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    // Simulate the user editing the value to 5.00.
    await prisma.productVariant.updateMany({
      where: { storeId, platformVariantId: BigInt(800_102) },
      data: { dimensionalWeight: '5.00' },
    });

    // Second sync: Trendyol now reports 2.0 (their pipeline recomputed).
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 800_002,
            productMainId: 'TS-DESI-2',
            title: 'Desi Override Survives',
            variants: [
              {
                variantId: 800_102,
                barcode: 'desi-bc-2',
                stockCode: 'desi-sk-2',
                dimensionalWeight: 2.0,
              },
            ],
          }),
        ],
      }),
    );
    const log2 = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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
    await processProductsChunk({ syncLog: log2, cursor: null, workerId: 'worker-test' });

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(800_102) },
    });
    // User value untouched.
    expect(variant.dimensionalWeight?.toString()).toBe('5');
    // Synced column refreshed.
    expect(variant.syncedDimensionalWeight?.toString()).toBe('2');
  });

  it('stores omitted or zero dimensionalWeight from Trendyol as 0 (desi floor is 0, never null)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 800_003,
            productMainId: 'TS-DESI-3',
            title: 'Desi Missing Product',
            variants: [
              // Omitted (real Trendyol responses often skip this field
              // until their pricing pipeline computes it) → stored as 0.
              { variantId: 800_103, barcode: 'desi-bc-3a', stockCode: 'desi-sk-3a' },
              // Explicit 0 → also stored as 0. Desi 0 is the floor and a valid
              // tariff tier (the tariff table covers desi 0 onward).
              {
                variantId: 800_104,
                barcode: 'desi-bc-3b',
                stockCode: 'desi-sk-3b',
                dimensionalWeight: 0,
              },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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
    await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });

    const missing = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(800_103) },
    });
    const zero = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(800_104) },
    });
    expect(missing.syncedDimensionalWeight.toString()).toBe('0');
    expect(zero.syncedDimensionalWeight.toString()).toBe('0');
  });

  it('stores the derived status and the Trendyol reason, and a re-sync rewrites both', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    function statusPage(locked: boolean): Response {
      return jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 820_001,
            productMainId: 'TS-STATUS-1',
            title: 'Status Product',
            variants: [
              {
                variantId: 820_101,
                barcode: 'st-bc-1',
                stockCode: 'st-sk-1',
                // onSale keeps the fixture default (true); the lock takes precedence.
                locked,
                lockReason: locked ? 'CRITICAL_SALE_PRICE_CHANGE' : null,
              },
              { variantId: 820_102, barcode: 'st-bc-2', stockCode: 'st-sk-2', onSale: false },
            ],
          }),
        ],
      });
    }

    async function runScan(): Promise<void> {
      const log = await prisma.syncLog.create({
        data: {
          organizationId: org.id,
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
      await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });
      // Free the (store_id, sync_type) active-sync slot for the next scan.
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(statusPage(true));
    await runScan();

    const locked = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(820_101) },
    });
    expect(locked.status).toBe(ProductVariantStatus.LOCKED);
    expect(locked.statusReason).toBe('CRITICAL_SALE_PRICE_CHANGE');
    const closed = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(820_102) },
    });
    expect(closed.status).toBe(ProductVariantStatus.NOT_ON_SALE);
    expect(closed.statusReason).toBeNull();

    // Trendyol lifts the lock: the update clause must rewrite status and reason.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(statusPage(false));
    await runScan();

    const unlocked = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(820_101) },
    });
    expect(unlocked.status).toBe(ProductVariantStatus.ON_SALE);
    expect(unlocked.statusReason).toBeNull();
  });

  it('a re-sync replaces the whole imageUrls list in Trendyol order, and clears it when no images come back', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);
    const contentId = 830_001;

    function imagesPage(imageUrls: string[]): Response {
      return jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId,
            productMainId: 'TS-IMAGES-1',
            title: 'Images Product',
            imageUrls,
            variants: [{ variantId: 830_101, barcode: 'img-bc-1', stockCode: 'img-sk-1' }],
          }),
        ],
      });
    }

    async function runScan(imageUrls: string[]): Promise<string[]> {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(imagesPage(imageUrls));
      const log = await prisma.syncLog.create({
        data: {
          organizationId: org.id,
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
      await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });
      // Free the (store_id, sync_type) active-sync slot for the next scan.
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const product = await prisma.product.findFirstOrThrow({
        where: { storeId, platformContentId: BigInt(contentId) },
      });
      return product.imageUrls;
    }

    expect(
      await runScan(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']),
    ).toEqual(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);

    // Trendyol reorders and swaps the images: the update clause replaces the list.
    expect(
      await runScan(['https://cdn.example.com/c.jpg', 'https://cdn.example.com/a.jpg']),
    ).toEqual(['https://cdn.example.com/c.jpg', 'https://cdn.example.com/a.jpg']);

    // Trendyol stops sending images: the list is cleared, not left stale.
    expect(await runScan([])).toEqual([]);
  });

  it('keeps an archived variant out of Product.totalStock and the sale-price range', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 830_001,
            productMainId: 'TS-ARCHIVED-1',
            title: 'Archived Variant Product',
            variants: [
              {
                variantId: 830_101,
                barcode: 'arc-bc-1',
                stockCode: 'arc-sk-1',
                quantity: 7,
                salePrice: 89.5,
              },
              {
                variantId: 830_102,
                barcode: 'arc-bc-2',
                stockCode: 'arc-sk-2',
                quantity: 100,
                salePrice: 10,
                archived: true,
              },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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
    await processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' });

    const product = await prisma.product.findFirstOrThrow({
      where: { storeId, platformContentId: BigInt(830_001) },
    });
    expect(product.totalStock).toBe(7);
    expect(product.minSalePrice?.toString()).toBe('89.5');
    expect(product.maxSalePrice?.toString()).toBe('89.5');

    // The archived variant is still catalogued, only outside the listing scope.
    const archived = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(830_102) },
    });
    expect(archived.status).toBe(ProductVariantStatus.ARCHIVED);
  });

  it('delist-by-absence: a COMPLETE scan stamps a variant it no longer returned, leaving returned ones', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Stale variant: last touched by an OLD full scan, not present in the feed
    // this scan returns.
    await seedVariant(org.id, storeId, {
      contentId: 4001,
      variantId: 40010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    // A single-page, fully-documented scan: page 0 of 1, totalElements=1. After
    // upserting the one returned content, newProgress (1) reaches totalElements
    // → reached-end done → the delist pass runs.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 5001,
            productMainId: 'pm-5001',
            title: 'Still Listed Product',
            variants: [
              { variantId: 50010, barcode: 'fresh-1', stockCode: 'fresh-sk-1', size: 'M' },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    const stale = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(40010) },
    });
    const fresh = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(50010) },
    });
    // Absent from this complete scan → stamped.
    expect(stale.delistedAt).not.toBeNull();
    // Returned by this scan → untouched.
    expect(fresh.delistedAt).toBeNull();
  });

  it('delist-by-absence: reappearance in the feed clears an existing delistedAt via the upsert', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // A variant delisted by an earlier scan.
    await seedVariant(org.id, storeId, {
      contentId: 7001,
      variantId: 70010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      delistedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    // This scan returns that same content/variant again. Two pages
    // (totalElements=200) so the handler returns `continue` — the reappearance
    // clear is the upsert's job, isolated here from the complete-done pass.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 200,
        totalPages: 2,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 7001,
            productMainId: 'seed-pm-7001',
            title: 'Reappeared Product',
            variants: [{ variantId: 70010, barcode: 'seed-bc-70010', stockCode: 'seed-sk-70010' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('continue');

    const reappeared = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(70010) },
    });
    expect(reappeared.delistedAt).toBeNull();
  });

  it('delist-by-absence: re-aggregates the products of the variants it stamps', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Product 6001 loses one variant: the feed still returns the product, but
    // only with a new variant. The upsert-time refresh still counts the old one
    // (it is not delisted yet), so only the delist pass can drop it.
    const partial = await seedVariant(org.id, storeId, {
      contentId: 6001,
      variantId: 60010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      quantity: 4,
      salePrice: '40.00',
    });
    // Product 6101 is absent from the feed altogether; its aggregates still hold
    // what an earlier scan computed.
    const absent = await seedVariant(org.id, storeId, {
      contentId: 6101,
      variantId: 61010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      quantity: 9,
      salePrice: '90.00',
    });
    await prisma.product.update({
      where: { id: absent.productId },
      data: { totalStock: 9, minSalePrice: '90.00', maxSalePrice: '90.00' },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 6001,
            productMainId: 'seed-pm-6001',
            title: 'Partially Delisted Product',
            variants: [
              {
                variantId: 60011,
                barcode: 'pd-bc-1',
                stockCode: 'pd-sk-1',
                quantity: 6,
                salePrice: 60,
              },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    // 6001: only the new variant counts once the old one is stamped.
    const partialProduct = await prisma.product.findUniqueOrThrow({
      where: { id: partial.productId },
    });
    expect(partialProduct.totalStock).toBe(6);
    expect(partialProduct.minSalePrice?.toString()).toBe('60');
    expect(partialProduct.maxSalePrice?.toString()).toBe('60');

    // 6101: no listed variant left, so zero stock and no price range.
    const absentProduct = await prisma.product.findUniqueOrThrow({
      where: { id: absent.productId },
    });
    expect(absentProduct.totalStock).toBe(0);
    expect(absentProduct.minSalePrice).toBeNull();
    expect(absentProduct.maxSalePrice).toBeNull();
  });

  it('delist-by-absence: stamps and re-aggregates candidates across more than one chunk', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // The run's startedAt is fixed up front so a variant can be seeded as
    // "returned by this scan" (lastSyncedAt after startedAt) without being in
    // the mocked feed.
    const startedAt = new Date();
    const freshLastSyncedAt = new Date(startedAt.getTime() + 60_000);

    // Product P1: one variant this scan returned (stays listed) plus a full
    // chunk of stale variants.
    const p1 = await seedVariant(org.id, storeId, {
      contentId: 6801,
      variantId: 68010,
      lastSyncedAt: freshLastSyncedAt,
      quantity: 5,
      salePrice: '50.00',
    });
    const p1StaleVariantIds = Array.from(
      { length: DELIST_CHUNK_SIZE },
      (_, index) => 680_100 + index,
    );
    await prisma.productVariant.createMany({
      data: p1StaleVariantIds.map((variantId) => ({
        organizationId: org.id,
        storeId,
        productId: p1.productId,
        platformVariantId: BigInt(variantId),
        barcode: `chunk-bc-${variantId.toString()}`,
        stockCode: `chunk-sk-${variantId.toString()}`,
        salePrice: '10.00',
        listPrice: '10.00',
        quantity: 1,
        lastSyncedAt: STALE_LAST_SYNCED_AT,
      })),
    });
    // Product P2: one more stale variant, seeded last, so the 201 candidates
    // spill past the first chunk into a second one.
    const p2VariantId = 68020;
    const p2 = await seedVariant(org.id, storeId, {
      contentId: 6802,
      variantId: p2VariantId,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      quantity: 1,
    });
    // Stale totals on both products, so only the pass's refresh can produce the
    // expected values.
    await prisma.product.updateMany({
      where: { id: { in: [p1.productId, p2.productId] } },
      data: { totalStock: 999, minSalePrice: '1.00', maxSalePrice: '2.00' },
    });

    const infoSpy = vi.spyOn(syncLog, 'info');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 6901,
            productMainId: 'pm-6901',
            title: 'Still Listed Product',
            variants: [{ variantId: 69010, barcode: 'mc-bc-1', stockCode: 'mc-sk-1' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt,
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    // Every one of the 201 candidates is stamped, the second chunk included.
    const staleVariantIds = [...p1StaleVariantIds, p2VariantId].map((id) => BigInt(id));
    expect(staleVariantIds).toHaveLength(DELIST_CHUNK_SIZE + 1);
    const staleWhere = { storeId, platformVariantId: { in: staleVariantIds } };
    expect(await prisma.productVariant.count({ where: staleWhere })).toBe(DELIST_CHUNK_SIZE + 1);
    expect(await prisma.productVariant.count({ where: { ...staleWhere, delistedAt: null } })).toBe(
      0,
    );
    expect(infoSpy).toHaveBeenCalledWith(
      'products.delisted-by-absence',
      expect.objectContaining({ syncLogId: log.id, storeId, count: DELIST_CHUNK_SIZE + 1 }),
    );

    // The variant this scan returned stays listed.
    const fresh = await prisma.productVariant.findUniqueOrThrow({
      where: { id: p1.variantDbId },
    });
    expect(fresh.delistedAt).toBeNull();

    // P1: only the fresh variant counts once its 200 stale siblings are stamped.
    const p1Product = await prisma.product.findUniqueOrThrow({ where: { id: p1.productId } });
    expect(p1Product.totalStock).toBe(5);
    expect(p1Product.minSalePrice?.toString()).toBe('50');
    expect(p1Product.maxSalePrice?.toString()).toBe('50');

    // P2: no listed variant left, so zero stock and no price range.
    const p2Product = await prisma.product.findUniqueOrThrow({ where: { id: p2.productId } });
    expect(p2Product.totalStock).toBe(0);
    expect(p2Product.minSalePrice).toBeNull();
    expect(p2Product.maxSalePrice).toBeNull();
  });

  it('delist-by-absence: leaves an already-delisted variant and another store of the same or another organization untouched', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // Positive control: a stale variant in the job's own store. The pass must
    // stamp it, so the "untouched" assertions below are checked against a pass
    // that really ran.
    const ownStale = await seedVariant(org.id, storeId, {
      contentId: 6202,
      variantId: 62020,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    // Delisted by an earlier pass and still absent: the original stamp must
    // survive, because the pass only picks variants whose delistedAt is null.
    const earlierDelistedAt = new Date('2026-01-01T00:00:00.000Z');
    await seedVariant(org.id, storeId, {
      contentId: 6201,
      variantId: 62010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      delistedAt: earlierDelistedAt,
    });

    // A second store in the SAME organization (another seller account) carries
    // a stale variant of its own. The pass is store-scoped, not org-scoped, so
    // it must not stamp it or rewrite its product's totals. The scan never
    // decrypts this store's credentials; they only mirror createTestStore.
    const sameOrgStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Second Trendyol Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '2739',
        credentials: encryptCredentials({
          supplierId: '2739',
          apiKey: 'test-api-key-2',
          apiSecret: 'test-api-secret-2',
        }),
      },
    });
    const sameOrg = await seedVariant(org.id, sameOrgStore.id, {
      contentId: 6311,
      variantId: 63110,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      quantity: 7,
      salePrice: '70.00',
    });
    await prisma.product.update({
      where: { id: sameOrg.productId },
      data: { totalStock: 99, minSalePrice: '1.00', maxSalePrice: '2.00' },
    });

    // Another organization's store carries a stale variant of its own. Its
    // product holds totals a refresh would overwrite (it would write 8 / 80 / 80),
    // so a pass that leaked across stores would show in the stamp or the totals.
    const otherOrg = await createOrganization();
    const { storeId: otherStoreId } = await createTestStore(otherOrg.id);
    const other = await seedVariant(otherOrg.id, otherStoreId, {
      contentId: 6301,
      variantId: 63010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
      quantity: 8,
      salePrice: '80.00',
    });
    await prisma.product.update({
      where: { id: other.productId },
      data: { totalStock: 99, minSalePrice: '1.00', maxSalePrice: '2.00' },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 6401,
            productMainId: 'pm-6401',
            title: 'Still Listed Product',
            variants: [{ variantId: 64010, barcode: 'iso-bc-1', stockCode: 'iso-sk-1' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    // Positive control: this run's pass stamped the own store's stale variant.
    const ownStaleVariant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: ownStale.variantDbId },
    });
    expect(ownStaleVariant.delistedAt).not.toBeNull();

    // The earlier stamp is kept, never re-stamped with this scan's time.
    const earlier = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(62010) },
    });
    expect(earlier.delistedAt?.getTime()).toBe(earlierDelistedAt.getTime());

    // The same organization's second store: not stamped, totals not refreshed.
    const sameOrgVariant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: sameOrg.variantDbId },
    });
    expect(sameOrgVariant.delistedAt).toBeNull();
    const sameOrgProduct = await prisma.product.findUniqueOrThrow({
      where: { id: sameOrg.productId },
    });
    expect(sameOrgProduct.totalStock).toBe(99);
    expect(sameOrgProduct.minSalePrice?.toString()).toBe('1');
    expect(sameOrgProduct.maxSalePrice?.toString()).toBe('2');

    // The other organization's store: not stamped, totals not refreshed.
    const otherVariant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: other.variantDbId },
    });
    expect(otherVariant.delistedAt).toBeNull();
    const otherProduct = await prisma.product.findUniqueOrThrow({
      where: { id: other.productId },
    });
    expect(otherProduct.totalStock).toBe(99);
    expect(otherProduct.minSalePrice?.toString()).toBe('1');
    expect(otherProduct.maxSalePrice?.toString()).toBe('2');
  });

  it('delist-by-absence: heartbeats the claim so a long pass is not reaped as stale', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    await seedVariant(org.id, storeId, {
      contentId: 6501,
      variantId: 65010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 6601,
            productMainId: 'pm-6601',
            title: 'Heartbeat Product',
            variants: [{ variantId: 66010, barcode: 'hb-bc-1', stockCode: 'hb-sk-1' }],
          }),
        ],
      }),
    );

    // The last tick is far in the past: only the chunk itself can move it, and
    // the dispatcher's tick runs after the chunk returns, not during the pass.
    const staleTickAt = new Date('2020-01-01T00:00:00.000Z');
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: staleTickAt,
        attemptCount: 1,
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(after.lastTickAt?.getTime()).toBeGreaterThan(staleTickAt.getTime());
  });

  it('delist-by-absence: a pass whose claim was taken over stops without stamping', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    const stale = await seedVariant(org.id, storeId, {
      contentId: 6701,
      variantId: 67010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 6801,
            productMainId: 'pm-6801',
            title: 'Lease Lost Product',
            variants: [{ variantId: 68010, barcode: 'll-bc-1', stockCode: 'll-sk-1' }],
          }),
        ],
      }),
    );

    // The watchdog reaped this worker's claim and a peer re-claimed the row, so
    // the row is RUNNING under another worker id.
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-peer',
        lastTickAt: new Date(),
        attemptCount: 2,
      },
    });

    await expect(
      processProductsChunk({ syncLog: log, cursor: null, workerId: 'worker-test' }),
    ).rejects.toBeInstanceOf(LostLeaseError);

    // The peer owns the pass now: this worker stamped nothing.
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: stale.variantDbId },
    });
    expect(variant.delistedAt).toBeNull();
  });

  it('delist-by-absence: a scan that skipped a page does NOT delist (incomplete scan)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    await seedVariant(org.id, storeId, {
      contentId: 4001,
      variantId: 40010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    // Same complete-done shape as the happy-path test, but the SyncLog carries a
    // skipped page — variants on the dropped page were never returned yet are
    // still listed, so the pass must be skipped entirely.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 5001,
            productMainId: 'pm-5001',
            title: 'Still Listed Product',
            variants: [
              { variantId: 50010, barcode: 'fresh-1', stockCode: 'fresh-sk-1', size: 'M' },
            ],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        skippedPages: [
          {
            page: 24,
            attemptedAt: new Date().toISOString(),
            errorCode: 'MARKETPLACE_UNREACHABLE',
            httpStatus: 500,
          },
        ],
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    const stale = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(40010) },
    });
    // Skipped-page scan proves nothing about absence → never stamped.
    expect(stale.delistedAt).toBeNull();
  });

  it('delist-by-absence: a truncated (past-cap, no-token) scan does NOT delist', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    await seedVariant(org.id, storeId, {
      contentId: 4001,
      variantId: 40010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    // Processing page 99 (items 9900-9999); the next page crosses the 10k cap
    // and no nextPageToken is provided → the truncation done branch. The tail of
    // the catalog was never scanned, so absence is unknowable and the pass is
    // skipped.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 20000,
        totalPages: 200,
        page: 99,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 99001,
            productMainId: 'pm-99001',
            title: 'Cap Boundary Product',
            variants: [{ variantId: 990010, barcode: 'cap-1', stockCode: 'cap-sk-1', size: 'M' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: { kind: 'page', n: 99 },
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    const stale = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(40010) },
    });
    // Truncated scan proves nothing about the unscanned tail → never stamped.
    expect(stale.delistedAt).toBeNull();
  });

  it('above the 10k cap: a token cursor WITH a nextPageToken continues the token chain (never resets to page 0)', async () => {
    // Regression for the collapse bug: a token cursor used to fall through
    // `cursor.kind === 'page' ? cursor.n : 0`, resetting the walk to page 1 and
    // abandoning the >10k tail. Past the cap (progressCurrent >= 10k so the
    // recovery path leaves the token intact) the handler must CONTINUE the token
    // chain with Trendyol's next token.
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 20000,
        totalPages: 200,
        page: 100,
        size: 100,
        nextPageToken: 'tok-next',
        content: [
          buildContent({
            contentId: 100_001,
            productMainId: 'pm-100001',
            title: 'Past Cap Product',
            variants: [{ variantId: 1_000_010, barcode: 'pc-1', stockCode: 'pc-sk-1', size: 'M' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: { kind: 'token', token: 'tok-current' },
      workerId: 'worker-test',
    });

    // The request rode the CURRENT token (no page fallback).
    const firstArg = fetchSpy.mock.calls[0]?.[0];
    const url = typeof firstArg === 'string' ? firstArg : '';
    expect(url).toContain('nextPageToken=tok-current');
    expect(url).not.toContain('page=');

    // The next cursor is Trendyol's NEXT token, and progress advanced.
    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.cursor).toEqual({ kind: 'token', token: 'tok-next' });
    expect(result.progress).toBe(10001);
  });

  it('above the 10k cap: a token cursor with NO nextPageToken ends as truncated and SKIPS the delist pass', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    // A stale variant that WOULD be delisted if the pass ran — it must survive,
    // because the token chain ran dry past the cap and the tail is unscanned.
    await seedVariant(org.id, storeId, {
      contentId: 4001,
      variantId: 40010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    const warnSpy = vi.spyOn(syncLog, 'warn');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 20000,
        totalPages: 200,
        page: 100,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 100_002,
            productMainId: 'pm-100002',
            title: 'Past Cap No Token Product',
            variants: [{ variantId: 1_000_020, barcode: 'pc-2', stockCode: 'pc-sk-2', size: 'L' }],
          }),
        ],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
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

    const result = await processProductsChunk({
      syncLog: log,
      cursor: { kind: 'token', token: 'tok-current' },
      workerId: 'worker-test',
    });

    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.finalCount).toBe(10001);

    expect(warnSpy).toHaveBeenCalledWith(
      'products.catalog-truncated-10k',
      expect.objectContaining({ syncLogId: log.id, storeId, progress: 10001 }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'products.delist-pass-skipped',
      expect.objectContaining({ doneReason: 'truncated-past-cap', reason: 'truncated-past-cap' }),
    );

    const stale = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(40010) },
    });
    expect(stale.delistedAt).toBeNull();
  });

  it('delist guard: an empty FIRST page over a nonzero catalog does NOT mass-delist (untrusted emptiness)', async () => {
    // The dangerous case FIX 2 closes: a transient empty content[] on page 0
    // while Trendyol still claims totalElements > 0. Every variant carries a
    // stale lastSyncedAt (none refreshed this run), so an unguarded pass would
    // delist the WHOLE catalog. The guard skips it (progressCurrent 0 AND no
    // vendor-confirmed empty catalog).
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const { storeId } = await createTestStore(org.id);

    await seedVariant(org.id, storeId, {
      contentId: 4001,
      variantId: 40010,
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    });

    const warnSpy = vi.spyOn(syncLog, 'warn');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 200,
        totalPages: 2,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [],
      }),
    );

    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 0,
        progressTotal: 200,
      },
    });

    const result = await processProductsChunk({
      syncLog: log,
      cursor: null,
      workerId: 'worker-test',
    });
    expect(result.kind).toBe('done');

    expect(warnSpy).toHaveBeenCalledWith(
      'products.delist-pass-skipped',
      expect.objectContaining({ doneReason: 'empty-page', reason: 'untrusted-empty-scan' }),
    );

    const stale = await prisma.productVariant.findFirstOrThrow({
      where: { storeId, platformVariantId: BigInt(40010) },
    });
    // Untrusted empty scan → the whole catalog is spared.
    expect(stale.delistedAt).toBeNull();
  });
});
