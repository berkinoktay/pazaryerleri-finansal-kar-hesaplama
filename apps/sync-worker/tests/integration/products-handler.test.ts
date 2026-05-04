// Integration test for the chunked products handler.
// One invocation = one Trendyol page → upsert → return cursor or 'done'.
// Reuses apps/api test helpers — apps/sync-worker has no factories of its own
// yet (same pattern as packages/sync-core's claim/checkpoint integration tests).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';

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
}

interface VariantSpec {
  variantId: number;
  barcode: string;
  stockCode: string;
  size?: string;
  salePrice?: number;
  quantity?: number;
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
    images: [{ url: `https://cdn.example.com/${spec.contentId.toString()}.jpg` }],
    attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' }],
    variants: spec.variants.map((v) => ({
      variantId: v.variantId,
      supplierId: 2738,
      barcode: v.barcode,
      attributes:
        v.size !== undefined
          ? [{ attributeId: 293, attributeName: 'Beden', attributeValue: v.size }]
          : [],
      onSale: true,
      deliveryOptions: { deliveryDuration: 1, isRushDelivery: true, fastDeliveryOptions: [] },
      stock: { quantity: v.quantity ?? 10, lastModifiedDate: 0 },
      price: { salePrice: v.salePrice ?? 100, listPrice: v.salePrice ?? 100 },
      stockCode: v.stockCode,
      vatRate: 20,
      locked: false,
      archived: false,
      blacklisted: false,
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

    const result = await processProductsChunk({ syncLog: log, cursor: null });

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    expect(result.progress).toBe(1);
    expect(result.total).toBe(200);
    expect(result.stage).toBe('upserting');
    expect(result.cursor).toEqual({ kind: 'page', n: 1 });

    const products = await prisma.product.findMany({ where: { storeId } });
    expect(products).toHaveLength(1);
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
    });

    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.finalCount).toBe(5490); // 5489 + 1 from this last page's batch
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

    await processProductsChunk({ syncLog: log, cursor: null });

    const product = await prisma.product.findFirstOrThrow({
      where: { storeId, platformContentId: BigInt(900_001) },
    });
    expect(product.totalStock).toBe(20);
  });
});
