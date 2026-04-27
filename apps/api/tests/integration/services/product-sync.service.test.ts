import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { encryptCredentials } from '@/lib/crypto';
import { SyncInProgressError } from '@/lib/errors';
import * as productSyncService from '@/services/product-sync.service';
import * as syncLogService from '@/services/sync-log.service';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../helpers/factories';

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

describe('ProductSyncService.run', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path — fetcher yields one batch, batch upserts to DB, SyncLog flips to COMPLETED', async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const { storeId } = await createTestStore(orgA.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 2,
        totalPages: 1,
        page: 0,
        size: 100,
        nextPageToken: null,
        content: [
          buildContent({
            contentId: 1001,
            productMainId: 'pm-1',
            title: 'Product One',
            variants: [{ variantId: 10010, barcode: 'bc-1', stockCode: 'sk-1', size: 'M' }],
          }),
          buildContent({
            contentId: 1002,
            productMainId: 'pm-2',
            title: 'Product Two',
            variants: [
              { variantId: 10020, barcode: 'bc-2a', stockCode: 'sk-2', size: 'S' },
              { variantId: 10021, barcode: 'bc-2b', stockCode: 'sk-2', size: 'L' },
            ],
          }),
        ],
      }),
    );

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const log = await syncLogService.acquireSlot(orgA.id, store.id, 'PRODUCTS');
    await productSyncService.run({ store, syncLogId: log.id });

    const refetchedLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(refetchedLog.status).toBe('COMPLETED');
    expect(refetchedLog.recordsProcessed).toBe(2);
    expect(refetchedLog.progressCurrent).toBe(2);
    expect(refetchedLog.progressTotal).toBe(2);
    expect(refetchedLog.errorCode).toBeNull();
    expect(refetchedLog.completedAt).not.toBeNull();

    const products = await prisma.product.findMany({
      where: { storeId },
      include: { variants: true, images: true },
    });
    expect(products).toHaveLength(2);
    const productOne = products.find((p) => p.productMainId === 'pm-1');
    const productTwo = products.find((p) => p.productMainId === 'pm-2');
    expect(productOne?.variants).toHaveLength(1);
    expect(productTwo?.variants).toHaveLength(2);
    expect(productOne?.images).toHaveLength(1);
    expect(productOne?.color).toBe('Mavi');

    const refetchedStore = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(refetchedStore.lastSyncAt).not.toBeNull();
  });

  it('idempotent — rerunning the sync produces identical row counts', async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const { storeId } = await createTestStore(orgA.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const trendyolPage = jsonResponse({
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 100,
      nextPageToken: null,
      content: [
        buildContent({
          contentId: 2001,
          productMainId: 'pm-2001',
          title: 'Idempotent Product',
          variants: [{ variantId: 20010, barcode: 'idp-1', stockCode: 'idp-sk', size: 'M' }],
        }),
      ],
    });
    fetchSpy
      .mockResolvedValueOnce(trendyolPage.clone())
      .mockResolvedValueOnce(trendyolPage.clone());

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });

    const firstLog = await syncLogService.acquireSlot(orgA.id, store.id, 'PRODUCTS');
    await productSyncService.run({ store, syncLogId: firstLog.id });

    const firstCount = await prisma.product.count({ where: { storeId } });
    expect(firstCount).toBe(1);

    const secondLog = await syncLogService.acquireSlot(orgA.id, store.id, 'PRODUCTS');
    await productSyncService.run({ store, syncLogId: secondLog.id });

    const secondCount = await prisma.product.count({ where: { storeId } });
    expect(secondCount).toBe(1);
    expect(await prisma.productVariant.count({ where: { storeId } })).toBe(1);
  });

  it('archives variants that vanished from the latest fetch result', async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const { storeId } = await createTestStore(orgA.id);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stalePr = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId,
        platformContentId: BigInt(9999),
        productMainId: 'pm-stale',
        title: 'Stale Product',
        lastSyncedAt: yesterday,
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId,
        productId: stalePr.id,
        platformVariantId: BigInt(99990),
        barcode: 'stale-bc',
        stockCode: 'stale-sk',
        salePrice: '50.00',
        listPrice: '50.00',
        archived: false,
        lastSyncedAt: yesterday,
      },
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
            contentId: 3001,
            productMainId: 'pm-fresh',
            title: 'Fresh Product',
            variants: [{ variantId: 30010, barcode: 'fresh-bc', stockCode: 'fresh-sk', size: 'M' }],
          }),
        ],
      }),
    );

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const log = await syncLogService.acquireSlot(orgA.id, store.id, 'PRODUCTS');
    await productSyncService.run({ store, syncLogId: log.id });

    const staleVariant = await prisma.productVariant.findFirstOrThrow({
      where: { barcode: 'stale-bc' },
    });
    expect(staleVariant.archived).toBe(true);
  });

  it('records MARKETPLACE_AUTH_FAILED in SyncLog when Trendyol returns 401', async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const { storeId } = await createTestStore(orgA.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }));

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const log = await syncLogService.acquireSlot(orgA.id, store.id, 'PRODUCTS');
    await productSyncService.run({ store, syncLogId: log.id });

    const refetched = await prisma.syncLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(refetched.status).toBe('FAILED');
    expect(refetched.errorCode).toBe('MARKETPLACE_AUTH_FAILED');
  });
});

describe('syncLogService.acquireSlot — concurrent prevention', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('a second concurrent caller throws SyncInProgressError; the partial unique index rejects the INSERT atomically', async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const { storeId } = await createTestStore(orgA.id);

    const first = await syncLogService.acquireSlot(orgA.id, storeId, 'PRODUCTS');
    expect(first.status).toBe('RUNNING');

    await expect(syncLogService.acquireSlot(orgA.id, storeId, 'PRODUCTS')).rejects.toBeInstanceOf(
      SyncInProgressError,
    );

    // With sync_logs_active_slot_uniq, the second INSERT is rejected by
    // Postgres before any row hits the table — so exactly one sync_log
    // row exists for the slot and it is the winner, still RUNNING.
    const allRows = await prisma.syncLog.findMany({ where: { storeId, syncType: 'PRODUCTS' } });
    expect(allRows).toHaveLength(1);
    expect(allRows[0]?.id).toBe(first.id);
    expect(allRows[0]?.status).toBe('RUNNING');
  });

  it('reaps stale RUNNING rows older than 10 minutes before acquiring a new slot', async () => {
    const userA = await createUserProfile();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const { storeId } = await createTestStore(orgA.id);

    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    const stale = await prisma.syncLog.create({
      data: {
        organizationId: orgA.id,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: elevenMinutesAgo,
      },
    });

    const fresh = await syncLogService.acquireSlot(orgA.id, storeId, 'PRODUCTS');
    expect(fresh.status).toBe('RUNNING');

    const reaped = await prisma.syncLog.findUniqueOrThrow({ where: { id: stale.id } });
    expect(reaped.status).toBe('FAILED');
    expect(reaped.errorCode).toBe('SYNC_TIMEOUT');
  });
});
