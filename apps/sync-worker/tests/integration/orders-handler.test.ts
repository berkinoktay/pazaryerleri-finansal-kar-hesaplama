// Integration test: orders sync handler (BUG #9 stream endpoint).
//
// Drives the chunk loop with a mocked Trendyol `getShipmentPackagesStream`
// response and verifies:
//   1. Order rows created (NEW convention: saleSubtotalNet, saleVatTotal,
//      agreedDeliveryDate, fastDelivery, micro, platformOrderNumber)
//   2. OrderItem rows created with KDV-split (unitPriceNet/VatRate/VatAmount,
//      grossCommissionAmountNet/VatAmount, sellerDiscountNet/VatAmount)
//   3. Variant lookup by barcode (or null for unmatched)
//   4. Idempotency (re-sync same page → no duplicates)
//   5. applyEstimateOnOrderCreate plug-in — PSF + Stopaj ESTIMATE OrderFee
//   6. Stream cursor advance within a chunk (hasMore + nextCursor)
//   7. Chunk transition (hasMore=false → chunkIndex+1, streamCursor=null)
//   8. Window contract — 14-day per-call cap (vendor enforced)

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolOrdersStreamResponse, TrendyolShipmentPackage } from '@pazarsync/marketplace';
import { encryptCredentials } from '@pazarsync/sync-core';
import type { OrdersStreamWindowCursor } from '@pazarsync/sync-core';

import {
  computeStreamChunkCount,
  processOrdersChunk,
  STREAM_CHUNK_DAYS,
  upsertOrderWithSnapshot,
} from '../../src/handlers/orders';

import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ORIGINAL_ENV = process.env;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Test order dates fall after FeeDefinition seed `effectiveFrom`
// (2026-05-18), otherwise `resolveFeeDefinition` rejects T+0 estimate.
const ORDER_DATE_MS = Date.UTC(2026, 4, 19); // 2026-05-19
const AGREED_DATE_MS = Date.UTC(2026, 4, 20);
const DELIVERED_DATE_MS = Date.UTC(2026, 4, 20, 12);
const LAST_MODIFIED_MS = Date.UTC(2026, 4, 20, 13);

function makeShipmentPackage(
  overrides: Partial<TrendyolShipmentPackage> = {},
): TrendyolShipmentPackage {
  return {
    orderNumber: '11101228439',
    shipmentPackageId: 3734026895,
    status: 'Delivered',
    orderDate: ORDER_DATE_MS,
    lastModifiedDate: LAST_MODIFIED_MS,
    agreedDeliveryDate: AGREED_DATE_MS,
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 120,
    lines: [
      {
        lineId: 1,
        barcode: 'EAN13-ORD-001',
        quantity: 1,
        lineUnitPrice: 120,
        lineGrossAmount: 120,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
    packageHistories: [{ status: 'Delivered', createdDate: DELIVERED_DATE_MS }],
    ...overrides,
  };
}

function makeStreamResponse(args: {
  hasMore: boolean;
  nextCursor: string | null;
  content: TrendyolShipmentPackage[];
}): TrendyolOrdersStreamResponse {
  return {
    hasMore: args.hasMore,
    nextCursor: args.nextCursor,
    size: args.content.length,
    content: args.content,
  };
}

async function setupStoreAndSyncLog(barcodes: string[] = [], opts: { storeCreatedAt?: Date } = {}) {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Orders Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '2738',
      // Default backdated 100d so the multi-chunk suite (backfill=90) reproduces
      // the 7-chunk / 14-day-window behavior these tests assert. Forward-only
      // tests pass an explicit recent createdAt.
      createdAt: opts.storeCreatedAt ?? new Date(Date.now() - 100 * MS_PER_DAY),
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      }),
    },
  });

  // PR-B calculability gate: a seeded variant must carry a cost profile or the
  // handler hard-skips its order. One profile per store, linked to each variant.
  const costProfile = barcodes.length > 0 ? await createCostProfile(org.id) : null;
  for (const barcode of barcodes) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
        productMainId: `pm-${barcode}`,
        title: `Product ${barcode}`,
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
        barcode,
        stockCode: `sk-${barcode}`,
        salePrice: '100',
        listPrice: '120',
        ...(costProfile !== null
          ? { costProfileLinks: { create: { organizationId: org.id, profileId: costProfile.id } } }
          : {}),
      },
    });
  }

  const log = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'ORDERS',
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  return { org, store, log };
}

describe('processOrdersChunk — stream endpoint (BUG #9)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    // Multi-chunk suite: 90d backfill + 100d-old store ⇒ ceil(90/14)=7 chunks,
    // 14-day windows — the behavior these chunk-mechanics tests assert.
    process.env = { ...ORIGINAL_ENV, SYNC_HISTORICAL_BACKFILL_DAYS: '90' };
    await truncateAll();
    // applyEstimateOnOrderCreate PSF + Stopaj FeeDefinition rows ister.
    await ensureFeeDefinitions();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('happy path: upserts Order + OrderItem with NEW convention; advances to next chunk', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [makeShipmentPackage()],
        }),
      ),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });

    // hasMore=false on chunk 0 → continue with chunkIndex=1 (not done yet —
    // multi-chunk backfill, chunkCount=7).
    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    const cursor = result.cursor as OrdersStreamWindowCursor;
    expect(cursor.kind).toBe('stream-window');
    expect(cursor.chunkIndex).toBe(1);
    expect(cursor.streamCursor).toBeNull();

    const orders = await prisma.order.findMany({ where: { storeId: store.id } });
    expect(orders).toHaveLength(1);

    const order = orders[0]!;
    expect(order.platformOrderId).toBe('3734026895');
    expect(order.platformOrderNumber).toBe('11101228439');
    expect(order.status).toBe('DELIVERED');
    expect(new Decimal(order.saleSubtotalNet!).toString()).toBe('100');
    expect(new Decimal(order.saleVatTotal!).toString()).toBe('20');
    expect(order.agreedDeliveryDate?.getTime()).toBe(AGREED_DATE_MS);
    expect(order.actualDeliveryDate?.getTime()).toBe(DELIVERED_DATE_MS);
    expect(order.fastDelivery).toBe(false);
    expect(order.reconciliationStatus).toBe('NOT_SETTLED');
    // PR-B: the order is calculable (variant + cost seeded), so the estimate
    // is computed (non-null) alongside the ESTIMATE OrderFee rows.
    expect(order.estimatedNetProfit).not.toBeNull();

    const fees = await prisma.orderFee.findMany({
      where: { orderId: order.id, source: 'ESTIMATE' },
      orderBy: { feeType: 'asc' },
    });
    expect(fees.map((f) => f.feeType)).toEqual(['PLATFORM_SERVICE', 'STOPPAGE']);

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(new Decimal(item.unitPriceNet!).toString()).toBe('100');
    expect(new Decimal(item.unitVatAmount!).toString()).toBe('20');
    expect(new Decimal(item.grossCommissionAmountNet).toString()).toBe('10');
    expect(new Decimal(item.grossCommissionVatAmount).toString()).toBe('2');
  });

  it('variant barcode match: OrderItem.productVariantId set when barcode exists', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-MATCH']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [
            makeShipmentPackage({
              lines: [
                {
                  lineId: 1,
                  barcode: 'EAN13-MATCH',
                  quantity: 1,
                  lineUnitPrice: 120,
                  lineGrossAmount: 120,
                  vatRate: 20,
                  commission: 10,
                },
              ],
            }),
          ],
        }),
      ),
    );

    await processOrdersChunk({ syncLog: log, cursor: null });

    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id } },
    });
    expect(item.productVariantId).not.toBeNull();
  });

  // PR-B calculability gate: the old "graceful null-variant item" behavior is
  // gone — an unresolvable variant now hard-skips the whole order.
  it('calculability gate: variant not found → order skipped (not written)', async () => {
    const { store, log } = await setupStoreAndSyncLog([]); // no variants seeded

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [
            makeShipmentPackage({
              lines: [
                {
                  lineId: 1,
                  barcode: 'EAN13-UNKNOWN',
                  quantity: 1,
                  lineUnitPrice: 120,
                  lineGrossAmount: 120,
                  vatRate: 20,
                  commission: 10,
                },
              ],
            }),
          ],
        }),
      ),
    );

    await processOrdersChunk({ syncLog: log, cursor: null });

    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
  });

  it('calculability gate: variant exists but no cost → order skipped (not written)', async () => {
    const { org, store, log } = await setupStoreAndSyncLog([]);
    // Seed a variant WITHOUT a cost profile link.
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
        productMainId: 'pm-EAN13-NOCOST',
        title: 'No-cost Product',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
        barcode: 'EAN13-NOCOST',
        stockCode: 'sk-EAN13-NOCOST',
        salePrice: '100',
        listPrice: '120',
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [
            makeShipmentPackage({
              lines: [
                {
                  lineId: 1,
                  barcode: 'EAN13-NOCOST',
                  quantity: 1,
                  lineUnitPrice: 120,
                  lineGrossAmount: 120,
                  vatRate: 20,
                  commission: 10,
                },
              ],
            }),
          ],
        }),
      ),
    );

    await processOrdersChunk({ syncLog: log, cursor: null });

    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('idempotent: re-sync same page → no duplicate Order/OrderItem rows', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [makeShipmentPackage()],
        }),
      ),
    );
    await processOrdersChunk({ syncLog: log, cursor: null });
    vi.restoreAllMocks();

    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);

    // Second sync (same page, same data) — idempotent
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [makeShipmentPackage()],
        }),
      ),
    );
    await processOrdersChunk({ syncLog: log, cursor: null });

    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);
  });

  it('cursor advance within chunk: hasMore + nextCursor → streamCursor updated, chunkIndex unchanged', async () => {
    const { log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: true,
          nextCursor: 'opaque-token-xyz',
          content: [makeShipmentPackage()],
        }),
      ),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    const cursor = result.cursor as OrdersStreamWindowCursor;
    expect(cursor.kind).toBe('stream-window');
    expect(cursor.chunkIndex).toBe(0); // same chunk
    expect(cursor.streamCursor).toBe('opaque-token-xyz');
    expect(result.progress).toBe(1);
    expect(result.total).toBeNull(); // stream omits totalElements
  });

  it('chunk transition: hasMore=false on chunk 0 → chunkIndex=1, streamCursor reset', async () => {
    const { log } = await setupStoreAndSyncLog([]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(makeStreamResponse({ hasMore: false, nextCursor: null, content: [] })),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    const cursor = result.cursor as OrdersStreamWindowCursor;
    expect(cursor.chunkIndex).toBe(1);
    expect(cursor.streamCursor).toBeNull();
    // endDate preserved across chunks (filter binding kuralı — doc line 77).
    expect(typeof cursor.endDate).toBe('number');
  });

  it('last chunk exhausted: hasMore=false on chunk N-1 → done', async () => {
    const { store, log } = await setupStoreAndSyncLog([]);
    const endDate = Date.now();
    const lastChunkIndex =
      computeStreamChunkCount({ storeCreatedAt: store.createdAt, endDate }) - 1;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(makeStreamResponse({ hasMore: false, nextCursor: null, content: [] })),
    );

    const resumeCursor: OrdersStreamWindowCursor = {
      kind: 'stream-window',
      endDate,
      chunkIndex: lastChunkIndex,
      streamCursor: null,
    };
    const result = await processOrdersChunk({ syncLog: log, cursor: resumeCursor });

    expect(result.kind).toBe('done');
  });

  it('initial backfill window: cursor null → 14-day lastModified window on chunk 0', async () => {
    const { log } = await setupStoreAndSyncLog([]);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(makeStreamResponse({ hasMore: false, nextCursor: null, content: [] })),
      );

    await processOrdersChunk({ syncLog: log, cursor: null });

    const url = fetchSpy.mock.calls[0]![0] as string;
    const parsed = new URL(url);
    // Vendor cap: lastModifiedStartDate/EndDate (NOT orderDate startDate/endDate)
    const lastModifiedStartDate = Number.parseInt(
      parsed.searchParams.get('lastModifiedStartDate')!,
      10,
    );
    const lastModifiedEndDate = Number.parseInt(
      parsed.searchParams.get('lastModifiedEndDate')!,
      10,
    );
    const windowDays = (lastModifiedEndDate - lastModifiedStartDate) / MS_PER_DAY;
    // Trendyol stream enforces ≤14d per call (STREAM_WINDOW_MAX_DAYS).
    // The handler chunks 90d into ceil(90/14)=7 sliding 14d slices.
    expect(windowDays).toBeCloseTo(STREAM_CHUNK_DAYS, 0);
    // Newest chunk ends at "now" — within a few seconds of test execution.
    expect(Math.abs(lastModifiedEndDate - Date.now())).toBeLessThan(5000);
    // No legacy startDate/endDate (page endpoint params) — stream uses
    // lastModifiedStartDate/EndDate exclusively.
    expect(parsed.searchParams.get('startDate')).toBeNull();
    expect(parsed.searchParams.get('endDate')).toBeNull();
  });

  it('legacy page-window cursor → treated as fresh start (BUG #9 migration)', async () => {
    const { log } = await setupStoreAndSyncLog([]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(makeStreamResponse({ hasMore: false, nextCursor: null, content: [] })),
    );

    // Legacy `page-window` cursor from a SyncLog row written under the old
    // page-based handler. The new handler should ignore it and start fresh.
    const legacyCursor = {
      kind: 'page-window',
      startDate: Date.now() - 30 * MS_PER_DAY,
      endDate: Date.now(),
      n: 5,
    };

    const result = await processOrdersChunk({ syncLog: log, cursor: legacyCursor });

    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    const cursor = result.cursor as OrdersStreamWindowCursor;
    expect(cursor.kind).toBe('stream-window');
    expect(cursor.chunkIndex).toBe(1); // chunk 0 just processed (empty), advance to 1
  });
});

describe('upsertOrderWithSnapshot — standalone (direct call)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('writes Order with NEW convention + OrderItem KDV-split', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-DIRECT']);

    // mapTrendyolShipmentPackage output mock'u — pure DB write doğrulaması.
    const mappedOrder = {
      platformOrderId: '99999',
      platformOrderNumber: 'TY-99',
      orderDate: new Date('2026-05-19T10:00:00Z'),
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      status: 'DELIVERED' as const,
      saleSubtotalNet: '100.00',
      saleVatTotal: '20.00',
      agreedDeliveryDate: new Date('2026-05-20T00:00:00Z'),
      actualDeliveryDate: new Date('2026-05-19T18:00:00Z'),
      fastDelivery: true,
      micro: false,
      lines: [
        {
          barcode: 'EAN13-DIRECT',
          quantity: 1,
          unitPriceNet: '100',
          unitVatRate: '20',
          unitVatAmount: '20',
          grossCommissionAmountNet: '10',
          grossCommissionVatAmount: '2',
          sellerDiscountNet: '0',
          sellerDiscountVatAmount: '0',
          commissionRate: '10',
        },
      ],
    };

    await upsertOrderWithSnapshot(store.id, org.id, mappedOrder);

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('99999');
    expect(order.fastDelivery).toBe(true);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(new Decimal(item.unitPriceNet!).toString()).toBe('100');
    expect(item.productVariantId).not.toBeNull();
  });
});

describe('processOrdersChunk — forward-only cutoff (PR-A)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    // Production default: no historical backfill. A freshly connected store
    // ⇒ cutoff = store.createdAt ⇒ a single chunk covering [createdAt, now].
    process.env = { ...ORIGINAL_ENV, SYNC_HISTORICAL_BACKFILL_DAYS: '0' };
    await truncateAll();
    await ensureFeeDefinitions();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('fresh store + backfill=0 → single chunk → done after first page', async () => {
    const { log } = await setupStoreAndSyncLog([], { storeCreatedAt: new Date() });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(makeStreamResponse({ hasMore: false, nextCursor: null, content: [] })),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });

    // Only one chunk exists, so chunk 0 is the last → terminate immediately.
    expect(result.kind).toBe('done');
  });

  it('fresh store window floor is store.createdAt, not 14 days back', async () => {
    const storeCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const { log } = await setupStoreAndSyncLog([], { storeCreatedAt });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(makeStreamResponse({ hasMore: false, nextCursor: null, content: [] })),
      );

    await processOrdersChunk({ syncLog: log, cursor: null });

    const url = fetchSpy.mock.calls[0]![0] as string;
    const lastModifiedStartDate = Number.parseInt(
      new URL(url).searchParams.get('lastModifiedStartDate')!,
      10,
    );
    // Window floor is store.createdAt (≈2h ago), NOT now−14d.
    expect(Math.abs(lastModifiedStartDate - storeCreatedAt.getTime())).toBeLessThan(5000);
  });

  it('future-dated store.createdAt → no fetch, terminates immediately (chunkCount 0 guard)', async () => {
    // Pathological: store.createdAt after endDate (clock skew / seed data) ⇒
    // chunkCount 0. The handler must NOT call the vendor with an inverted window.
    const { log } = await setupStoreAndSyncLog([], {
      storeCreatedAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in the future
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await processOrdersChunk({ syncLog: log, cursor: null });

    expect(result.kind).toBe('done');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
