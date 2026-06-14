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
import { getBusinessDayRange } from '@pazarsync/utils';

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
import { approvedProductsResponse } from '../../../../apps/api/tests/helpers/trendyol-fixtures';

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

const MS_HOUR = 60 * 60 * 1000;

/**
 * A "today" orderDate as Trendyol sends it: GMT+3 (Istanbul wall-clock-as-UTC),
 * which the mapper normalizes back to the true instant. Encode noon Istanbul today
 * (real noon + the +3h offset) so the today→buffer gate is deterministic — a raw
 * `Date.now()` would normalize into "yesterday" when the suite runs between 00:00
 * and 03:00 Istanbul.
 */
function todayOrderDateGmt3(): number {
  return getBusinessDayRange().start.getTime() + 15 * MS_HOUR;
}

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

  it('co-funded order: saleSubtotalNet = effectiveSale (liste − satıcı indirimi), tyDiscount excluded (denetim #1)', async () => {
    // Stage-tipi Trendyol-finanslı sipariş — bu boşluğun (denetim #1) kör noktası:
    // hiçbir eski test tyDiscount>0 kapsamıyordu. Eski bug'da saleSubtotalNet lineUnitPrice'tan
    // (120 → net 100) kurulup formül satıcı indirimini BİR DAHA düşerdi → kâr eksik (hatta negatif).
    // Doğru: saleSubtotalNet = effectiveSale = (200 − 50) → net 125; Trendyol indirimi (30) HARİÇ
    // (geri ödeniyor, kâra etkisi YOK). Ayırt edici nokta: '125' ≠ eski '100'.
    const { store, log } = await setupStoreAndSyncLog(['EAN13-COFUND']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [
            makeShipmentPackage({
              packageGrossAmount: 200,
              lines: [
                {
                  lineId: 1,
                  barcode: 'EAN13-COFUND',
                  quantity: 1,
                  lineGrossAmount: 200,
                  lineSellerDiscount: 50,
                  lineTyDiscount: 30,
                  lineUnitPrice: 120, // 200 − 50 − 30 = müşterinin ödediği (satış DEĞİL)
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

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    // effectiveSale = 200 − 50 = 150 → net 125 (KDV 25). NOT 120/1.2=100, tyDiscount(30) hariç.
    expect(new Decimal(order.saleSubtotalNet!).toString()).toBe('125');
    expect(new Decimal(order.saleVatTotal!).toString()).toBe('25');
    // Pipeline çalıştı (variant + cost seeded → calculable); kâr indirimi çift düşmeden hesaplandı.
    expect(order.estimatedNetProfit).not.toBeNull();

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(new Decimal(item.unitPriceNet!).toString()).toBe('125'); // effective birim-net
    // Satıcı indirimi yalnız breakdown gösterimi için ayrıştırılır (50 / 1.2).
    expect(new Decimal(item.sellerDiscountNet).toString()).toBe('41.67');
    expect(new Decimal(item.sellerDiscountVatAmount).toString()).toBe('8.33');
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

  // Spec 2026-06-11: the variant_not_found hard-skip is gone — an unresolvable
  // variant routes through cost_missing and the order is ALWAYS written (the
  // unmatched line keeps the barcode trail with a null variant FK).
  it('calculability gate: variant not found → order persisted with a null-variant item', async () => {
    const { store, log } = await setupStoreAndSyncLog([]); // no variants seeded

    // Eager onarım (spec 2026-06-12 PR-2) artık stream'den SONRA approved-products
    // sorgusu da atar → tek-atımlık mock yerine endpoint-dallı implementasyon;
    // vendor-miss (0 sonuç) → satır eşleşmeden devam eder.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/products/approved') && url.includes('barcode=EAN13-UNKNOWN')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('EAN13-UNKNOWN', 0)));
      }
      if (url.includes('/integration/order/')) {
        return Promise.resolve(
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
      }
      throw new Error(`beklenmeyen fetch: ${url}`);
    });

    await processOrdersChunk({ syncLog: log, cursor: null });

    // ORDER_DATE_MS is past-day → persists PROFIT-EXCLUDED (spec 2026-06-12).
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.productVariantId).toBeNull();
    expect(item.barcode).toBe('EAN13-UNKNOWN');
  });

  it('cron intake: bilinmeyen barkod anında vendor sorgusuyla kataloğa eklenir', async () => {
    const { store, log } = await setupStoreAndSyncLog([]); // katalog boş

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/products/approved') && url.includes('barcode=EAGER-CRON-1')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('EAGER-CRON-1', 1)));
      }
      if (url.includes('/integration/order/')) {
        return Promise.resolve(
          jsonResponse(
            makeStreamResponse({
              hasMore: false,
              nextCursor: null,
              content: [
                makeShipmentPackage({
                  lines: [
                    {
                      lineId: 1,
                      barcode: 'EAGER-CRON-1',
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
      }
      throw new Error(`beklenmeyen fetch: ${url}`);
    });

    await processOrdersChunk({ syncLog: log, cursor: null });

    expect(
      await prisma.productVariant.count({ where: { storeId: store.id, barcode: 'EAGER-CRON-1' } }),
    ).toBe(1);
    // ORDER_DATE_MS geçmiş gün → maliyetsiz ürün → KÂR-DIŞI yazım (PR-1) ama
    // kalem ürün KİMLİĞİYLE bağlı (görünürlük sözleşmesi).
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id } },
    });
    expect(item.productVariantId).not.toBeNull();
  });

  it('cost-missing + past-day → order persisted PROFIT-EXCLUDED (not skipped)', async () => {
    const { org, store, log } = await setupStoreAndSyncLog([]);
    // Seed a variant WITHOUT a cost profile link → cost_missing.
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

    // ORDER_DATE_MS is past-day → persisted PROFIT-EXCLUDED, not buffered.
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.organizationId).toBe(org.id);
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
  });

  it('cost-missing + today → buffers (PENDING), no orders row (1A symmetry)', async () => {
    const { org, store, log } = await setupStoreAndSyncLog([]);
    // Variant resolves (the gap is the cost, not the variant) — NO cost profile.
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
        productMainId: 'pm-EAN13-TODAY',
        title: 'Today No-cost Product',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
        barcode: 'EAN13-TODAY',
        stockCode: 'sk-EAN13-TODAY',
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
              orderDate: todayOrderDateGmt3(), // today → buffer, not orders
              lines: [
                {
                  lineId: 1,
                  barcode: 'EAN13-TODAY',
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

    // 1A: sync-worker mirrors the webhook — today's cost-missing → PENDING buffer.
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
    const entries = await prisma.livePerformanceBuffer.findMany({ where: { storeId: store.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.organizationId).toBe(org.id);
    expect(entries[0]!.status).toBe('PENDING');
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
      dematerialized: false,
      saleSubtotalNet: '100.00',
      saleVatTotal: '20.00',
      agreedDeliveryDate: new Date('2026-05-20T00:00:00Z'),
      actualDeliveryDate: new Date('2026-05-19T18:00:00Z'),
      fastDelivery: true,
      micro: false,
      cargoProviderName: 'Trendyol Express Marketplace',
      cargoTrackingNumber: '7330000167510333',
      cargoDeci: '2.00',
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      originShipmentDate: new Date('2026-05-19T09:00:00Z'),
      lines: [
        {
          barcode: 'EAN13-DIRECT',
          quantity: 1,
          platformLineId: '10328256',
          unitPriceNet: '100',
          unitVatRate: '20',
          unitVatAmount: '20',
          grossCommissionAmountNet: '10',
          grossCommissionVatAmount: '2',
          refundedCommissionAmountNet: '0',
          refundedCommissionVatAmount: '0',
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
    // PR-8 cargo enrichment lands on CREATE.
    expect(order.cargoProviderName).toBe('Trendyol Express Marketplace');
    expect(order.cargoTrackingNumber).toBe(7330000167510333n);
    expect(new Decimal(order.cargoDeci!.toString()).toString()).toBe('2');
    expect(order.usesSellerCargoAgreement).toBe(false);
    expect(order.platformCreatedBy).toBe('order-creation');
    expect(order.originShipmentDate?.toISOString()).toBe('2026-05-19T09:00:00.000Z');

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(new Decimal(item.unitPriceNet!).toString()).toBe('100');
    expect(item.productVariantId).not.toBeNull();
    // PR-8 line trail.
    expect(item.platformLineId).toBe(10328256n);
    expect(item.barcode).toBe('EAN13-DIRECT');
  });

  it('UPDATE refreshes cargo fields but never erases them with incoming nulls (PR-8)', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-DIRECT']);

    const base = {
      platformOrderId: '99998',
      platformOrderNumber: 'TY-98',
      orderDate: new Date('2026-05-19T10:00:00Z'),
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      status: 'PROCESSING' as const,
      dematerialized: false,
      saleSubtotalNet: '100.00',
      saleVatTotal: '20.00',
      agreedDeliveryDate: null,
      actualDeliveryDate: null,
      fastDelivery: false,
      micro: false,
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      lines: [
        {
          barcode: 'EAN13-DIRECT',
          quantity: 1,
          platformLineId: '10328999',
          unitPriceNet: '100',
          unitVatRate: '20',
          unitVatAmount: '20',
          grossCommissionAmountNet: '10',
          grossCommissionVatAmount: '2',
          refundedCommissionAmountNet: '0',
          refundedCommissionVatAmount: '0',
          sellerDiscountNet: '0',
          sellerDiscountVatAmount: '0',
          commissionRate: '10',
        },
      ],
    };

    // First sync: tracking assigned at creation, deci not yet measured.
    await upsertOrderWithSnapshot(store.id, org.id, {
      ...base,
      cargoProviderName: 'Trendyol Express Marketplace',
      cargoTrackingNumber: '7330000167519999',
      cargoDeci: null,
      originShipmentDate: new Date('2026-05-19T09:00:00Z'),
    });

    // Later feed: deci measured now, but this payload omits provider/tracking
    // (mapped as nulls) — they must survive.
    await upsertOrderWithSnapshot(store.id, org.id, {
      ...base,
      cargoProviderName: null,
      cargoTrackingNumber: null,
      cargoDeci: '3.50',
      originShipmentDate: null,
    });

    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: '99998' },
    });
    expect(order.cargoProviderName).toBe('Trendyol Express Marketplace');
    expect(order.cargoTrackingNumber).toBe(7330000167519999n);
    expect(new Decimal(order.cargoDeci!.toString()).toString()).toBe('3.5');
    expect(order.originShipmentDate?.toISOString()).toBe('2026-05-19T09:00:00.000Z');
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

describe('processOrdersChunk — delta window (periodic sync)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV, SYNC_SAFETY_NET_HOURS: '8' };
    await truncateAll();
    await ensureFeeDefinitions();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('prior COMPLETED ORDERS sync → window floor is now − SAFETY_NET_HOURS, not createdAt', async () => {
    // setupStoreAndSyncLog backdates store.createdAt to 100d ago.
    const { org, store, log } = await setupStoreAndSyncLog([]);
    // A prior COMPLETED ORDERS sync flips the handler into delta mode.
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'ORDERS',
        status: 'COMPLETED',
        startedAt: new Date(),
      },
    });

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
    // 100d-old store, but delta mode ⇒ floor = now − 8h, NOT createdAt.
    expect(Math.abs(lastModifiedStartDate - (Date.now() - 8 * 60 * 60 * 1000))).toBeLessThan(
      60_000,
    );
  });

  it('no prior COMPLETED sync → initial mode (window floor at store.createdAt)', async () => {
    // Fresh store, only a RUNNING sync (the in-flight one) ⇒ NOT delta.
    const recentCreatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
    const { log } = await setupStoreAndSyncLog([], { storeCreatedAt: recentCreatedAt });

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
    // Initial mode: floor = createdAt (3h ago), not the 8h safety-net window.
    expect(Math.abs(lastModifiedStartDate - recentCreatedAt.getTime())).toBeLessThan(5000);
  });
});
