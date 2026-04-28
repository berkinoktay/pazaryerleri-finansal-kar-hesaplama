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
});
