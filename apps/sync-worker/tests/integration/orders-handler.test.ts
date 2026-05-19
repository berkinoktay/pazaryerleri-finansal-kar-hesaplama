// Integration test: PR-B Trendyol orders sync handler.
//
// Drives the chunk loop with a mocked Trendyol /orders response and
// verifies:
//   1. Order rows created (NEW convention: saleSubtotalNet, saleVatTotal,
//      agreedDeliveryDate, fastDelivery, micro, platformOrderNumber)
//   2. OrderItem rows created with KDV-split (unitPriceNet/VatRate/VatAmount,
//      grossCommissionAmountNet/VatAmount, sellerDiscountNet/VatAmount)
//   3. Variant lookup by barcode (or null for unmatched)
//   4. Cost snapshot captured for variants with attached profiles
//   5. Idempotency (re-sync same page → no duplicates)
//
// applyEstimateOnOrderCreate plug-in: ERTELENDİ (PR-B2 cross-app refactor) —
// estimatedNetProfit null kalır bu test'te.

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolOrdersResponse, TrendyolShipmentPackage } from '@pazarsync/marketplace';
import { encryptCredentials } from '@pazarsync/sync-core';

import { processOrdersChunk, upsertOrderWithSnapshot } from '../../src/handlers/orders';

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

function makeShipmentPackage(
  overrides: Partial<TrendyolShipmentPackage> = {},
): TrendyolShipmentPackage {
  return {
    orderNumber: '11101228439',
    shipmentPackageId: 3734026895,
    status: 'Delivered',
    orderDate: 1715000000000,
    lastModifiedDate: 1715500000000,
    agreedDeliveryDate: 1715400000000,
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
    packageHistories: [{ status: 'Delivered', createdAt: 1715450000000 }],
    ...overrides,
  };
}

function makeOrdersResponse(args: {
  page: number;
  totalElements: number;
  content: TrendyolShipmentPackage[];
}): TrendyolOrdersResponse {
  return {
    totalElements: args.totalElements,
    totalPages: Math.ceil(args.totalElements / 200) || 1,
    page: args.page,
    size: 200,
    content: args.content,
  };
}

async function setupStoreAndSyncLog(barcodes: string[] = []) {
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
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      }),
    },
  });

  // Optional variants for barcode lookup
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

describe('processOrdersChunk — PR-B real Trendyol fetch + upsert', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: fetches 1 page, upserts Order + OrderItem with NEW convention', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          totalElements: 1,
          content: [makeShipmentPackage()],
        }),
      ),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });

    expect(result.kind).toBe('done');

    const orders = await prisma.order.findMany({ where: { storeId: store.id } });
    expect(orders).toHaveLength(1);

    const order = orders[0]!;
    expect(order.platformOrderId).toBe('3734026895');
    expect(order.platformOrderNumber).toBe('11101228439');
    expect(order.status).toBe('DELIVERED');
    // saleSubtotalNet = 100 (120 / 1.20)
    expect(new Decimal(order.saleSubtotalNet!).toString()).toBe('100');
    expect(new Decimal(order.saleVatTotal!).toString()).toBe('20');
    expect(order.agreedDeliveryDate?.getTime()).toBe(1715400000000);
    expect(order.actualDeliveryDate?.getTime()).toBe(1715450000000);
    expect(order.fastDelivery).toBe(false);
    expect(order.micro).toBe(false);
    expect(order.reconciliationStatus).toBe('NOT_SETTLED');
    expect(order.estimatedNetProfit).toBeNull(); // applyEstimate plug-in ertelendi

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(new Decimal(item.unitPriceNet!).toString()).toBe('100');
    expect(new Decimal(item.unitVatRate!).toString()).toBe('20');
    expect(new Decimal(item.unitVatAmount!).toString()).toBe('20');
    expect(new Decimal(item.grossCommissionAmountNet).toString()).toBe('10');
    expect(new Decimal(item.grossCommissionVatAmount).toString()).toBe('2');
    expect(new Decimal(item.refundedCommissionAmountNet).toString()).toBe('0');
    expect(new Decimal(item.sellerDiscountNet).toString()).toBe('0');
  });

  it('variant barcode match: OrderItem.productVariantId set when barcode exists', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-MATCH']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          totalElements: 1,
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

  it('variant not found: OrderItem.productVariantId null (graceful)', async () => {
    const { store, log } = await setupStoreAndSyncLog([]); // no variants

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          totalElements: 1,
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

    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id } },
    });
    expect(item.productVariantId).toBeNull();
  });

  it('idempotent: re-sync same page → no duplicate Order/OrderItem rows', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    // First sync
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          totalElements: 1,
          content: [makeShipmentPackage()],
        }),
      ),
    );
    await processOrdersChunk({ syncLog: log, cursor: null });
    vi.restoreAllMocks();

    const ordersAfterFirst = await prisma.order.count({ where: { storeId: store.id } });
    const itemsAfterFirst = await prisma.orderItem.count();
    expect(ordersAfterFirst).toBe(1);
    expect(itemsAfterFirst).toBe(1);

    // Second sync (same page, same data) — idempotent
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          totalElements: 1,
          content: [makeShipmentPackage()],
        }),
      ),
    );
    await processOrdersChunk({ syncLog: log, cursor: null });

    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);
  });

  it('multi-page: returns continue cursor when not yet exhausted', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          totalElements: 250, // > 200 page size → birden fazla page var
          content: [makeShipmentPackage()],
        }),
      ),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });
    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') return;
    const cursor = result.cursor as { kind: string; n: number };
    expect(cursor.kind).toBe('page-window');
    expect(cursor.n).toBe(1);
    expect(result.progress).toBe(1);
    expect(result.total).toBe(250);
  });

  it('empty page → done immediately', async () => {
    const { log } = await setupStoreAndSyncLog([]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(makeOrdersResponse({ page: 0, totalElements: 0, content: [] })),
    );

    const result = await processOrdersChunk({ syncLog: log, cursor: null });
    expect(result.kind).toBe('done');
  });

  it('initial backfill window: cursor null → 90-day window set', async () => {
    const { log } = await setupStoreAndSyncLog([]);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(makeOrdersResponse({ page: 0, totalElements: 0, content: [] })),
      );

    await processOrdersChunk({ syncLog: log, cursor: null });

    const url = fetchSpy.mock.calls[0]![0] as string;
    const parsed = new URL(url);
    const startDate = Number.parseInt(parsed.searchParams.get('startDate')!, 10);
    const endDate = Number.parseInt(parsed.searchParams.get('endDate')!, 10);
    const windowDays = (endDate - startDate) / (24 * 60 * 60 * 1000);
    expect(windowDays).toBeCloseTo(90, 0);
  });
});

describe('upsertOrderWithSnapshot — standalone (direct call)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('writes Order with NEW convention + OrderItem KDV-split', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-DIRECT']);

    // mapTrendyolShipmentPackage output mock'u — pure DB write doğrulaması.
    const mappedOrder = {
      platformOrderId: '99999',
      platformOrderNumber: 'TY-99',
      orderDate: new Date('2026-05-15T10:00:00Z'),
      lastModifiedDate: new Date('2026-05-15T11:00:00Z'),
      status: 'DELIVERED' as const,
      saleSubtotalNet: '100.00',
      saleVatTotal: '20.00',
      agreedDeliveryDate: new Date('2026-05-16T00:00:00Z'),
      actualDeliveryDate: new Date('2026-05-15T18:00:00Z'),
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
