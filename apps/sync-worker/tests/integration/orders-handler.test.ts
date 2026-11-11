// Integration test: orders sync handler (BUG #9 stream endpoint).
//
// Drives the chunk loop with a mocked Trendyol `getShipmentPackagesStream`
// response and verifies:
//   1. Order rows created (GROSS convention: saleGross, saleVat, listGross,
//      sellerDiscountGross, agreedDeliveryDate, fastDelivery, micro, platformOrderNumber)
//   2. OrderItem rows created with gross columns (lineListGross/lineSaleGross/
//      lineSellerDiscountGross/saleVatRate) + the raw orderCommissionRatePct
//   3. Variant lookup by barcode (or null for unmatched)
//   4. Idempotency (re-sync same page → no duplicates)
//   5. Profit recompute enqueue on every order write
//   6. Stream cursor advance within a chunk (hasMore + nextCursor)
//   7. Chunk transition (hasMore=false → chunkIndex+1, streamCursor=null)
//   8. Window contract — 14-day per-call cap (vendor enforced)

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  ProductVariantStatus,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import type {
  MappedOrder,
  TrendyolOrdersStreamResponse,
  TrendyolShipmentPackage,
} from '@pazarsync/marketplace';
import { drainProfitRecomputeQueue } from '@pazarsync/profit';
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
import {
  approvedProductsResponse,
  queriesBarcode,
} from '../../../../apps/api/tests/helpers/trendyol-fixtures';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ORIGINAL_ENV = process.env;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Test order dates fall after FeeDefinition seed `effectiveFrom`
// (2026-05-18), otherwise the profit drain's `resolveFeeDefinition` rejects them.
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
    // GROSS konvansiyon: paket toplamları doğrudan saleGross/listGross/
    // sellerDiscountGross'a yazılır. İndirimsiz: packageTotalPrice = packageGrossAmount.
    packageGrossAmount: 120,
    packageSellerDiscount: 0,
    packageTotalPrice: 120,
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

/**
 * A minimal single-line MappedOrder for the direct-call upsert tests (phase 3B
 * queue + snapshot + raw-rate behavior). orderDate is a fixed past day so the fee
 * definitions and cost versions the drain tests seed are already effective.
 */
function buildDirectMapped(over: {
  platformOrderId: string;
  barcode: string;
  status?: MappedOrder['status'];
  lastModifiedDate: Date;
  commissionKnown?: boolean;
  commissionRate?: string;
}): MappedOrder {
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: `TY-${over.platformOrderId}`,
    orderDate: new Date('2026-05-19T10:00:00Z'),
    lastModifiedDate: over.lastModifiedDate,
    status: over.status ?? 'PROCESSING',
    dematerialized: false,
    packagePending: false,
    saleGross: '120.00',
    saleVat: '20.00',
    listGross: '120.00',
    sellerDiscountGross: '0.00',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    actualShipDate: null,
    fastDelivery: false,
    fastDeliveryType: null,
    micro: false,
    estimatedDeliveryStartDate: null,
    estimatedDeliveryEndDate: null,
    cargoProviderName: null,
    cargoTrackingNumber: null,
    cargoDeci: null,
    usesSellerCargoAgreement: false,
    platformCreatedBy: 'order-creation',
    originShipmentDate: null,
    lines: [
      {
        barcode: over.barcode,
        quantity: 1,
        platformLineId: '9000001',
        lineListGross: '120.00',
        lineSaleGross: '120.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '20',
        commissionRate: over.commissionRate ?? '10',
        categoryId: null,
        commissionKnown: over.commissionKnown ?? true,
      },
    ],
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
    // The profit drain resolves its fee definitions (PSF, stoppage, ...) from these rows.
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
    // GROSS: saleGross = packageTotalPrice (120); saleVat = 120 × 20/120 = 20.
    expect(new Decimal(order.saleGross!).toString()).toBe('120');
    expect(new Decimal(order.saleVat!).toString()).toBe('20');
    expect(new Decimal(order.listGross!).toString()).toBe('120');
    expect(new Decimal(order.sellerDiscountGross!).toString()).toBe('0');
    expect(order.agreedDeliveryDate?.getTime()).toBe(AGREED_DATE_MS);
    expect(order.actualDeliveryDate?.getTime()).toBe(DELIVERED_DATE_MS);
    // deliveredOnTime is now derived from agreed vs actual + persisted (was always
    // null before this fix). Assert the computed relationship, not a hardcoded bool.
    expect(order.deliveredOnTime).toBe(DELIVERED_DATE_MS <= AGREED_DATE_MS);
    expect(order.fastDelivery).toBe(false);
    expect(order.reconciliationStatus).toBe('NOT_SETTLED');
    // Phase 3B: the order write enqueues a profit recompute; nothing is estimated inline.
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(1);
    const item = items[0]!;
    // GROSS: lineSaleGross = lineGrossAmount × qty (120). Only the raw line rate is
    // stored; the engine computes the commission itself.
    expect(new Decimal(item.lineSaleGross).toString()).toBe('120');
    expect(new Decimal(item.lineListGross).toString()).toBe('120');
    expect(new Decimal(item.lineSellerDiscountGross).toString()).toBe('0');
    expect(new Decimal(item.orderCommissionRatePct!).toString()).toBe('10');
  });

  it('stream page with a zero-id (Awaiting) package next to a normal one → only the normal one persists', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-ORD-001']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [
            // Awaiting order Trendyol has not created a package for yet: the mapper
            // flags it packagePending and intake skips it (shipmentPackageId 0 would
            // collide with every other Awaiting order on platformOrderId '0'). Same
            // barcode as the normal one so the catalog repair never touches the vendor.
            makeShipmentPackage({ shipmentPackageId: 0, orderNumber: 'awaiting-1' }),
            // A normal package with a real id persists as usual.
            makeShipmentPackage(),
          ],
        }),
      ),
    );

    await processOrdersChunk({ syncLog: log, cursor: null });

    const orders = await prisma.order.findMany({ where: { storeId: store.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.platformOrderId).toBe('3734026895');
    // Nothing keyed onto platformOrderId '0'.
    expect(await prisma.order.count({ where: { storeId: store.id, platformOrderId: '0' } })).toBe(
      0,
    );
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('co-funded order: saleGross = effectiveSale (liste − satıcı indirimi), tyDiscount excluded (denetim #1)', async () => {
    // Stage-tipi Trendyol-finanslı sipariş — bu boşluğun (denetim #1) kör noktası:
    // hiçbir eski test tyDiscount>0 kapsamıyordu. GROSS konvansiyon: saleGross =
    // packageTotalPrice = effectiveSale = liste − satıcı indirimi = 200 − 50 = 150.
    // Trendyol indirimi (30) packageTotalPrice'a DAHİL DEĞİL (geri ödeniyor, kâra etkisi YOK).
    const { store, log } = await setupStoreAndSyncLog(['EAN13-COFUND']);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({
          hasMore: false,
          nextCursor: null,
          content: [
            makeShipmentPackage({
              // GROSS paket toplamları: liste 200, satıcı indirimi 50 → effectiveSale 150.
              packageGrossAmount: 200,
              packageSellerDiscount: 50,
              packageTotalPrice: 150,
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
    // effectiveSale (GROSS) = 200 − 50 = 150; saleVat = 150 × 20/120 = 25.
    // tyDiscount(30) HARİÇ — packageTotalPrice'a girmez.
    expect(new Decimal(order.saleGross!).toString()).toBe('150');
    expect(new Decimal(order.saleVat!).toString()).toBe('25');
    expect(new Decimal(order.listGross!).toString()).toBe('200');
    expect(new Decimal(order.sellerDiscountGross!).toString()).toBe('50');
    // Phase 3B: the write enqueues a recompute (no inline estimate anymore).
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    // GROSS satır: lineSaleGross = 200 − 50 = 150; satıcı indirimi 50 ayrı kolonda.
    expect(new Decimal(item.lineSaleGross).toString()).toBe('150');
    expect(new Decimal(item.lineListGross).toString()).toBe('200');
    expect(new Decimal(item.lineSellerDiscountGross).toString()).toBe('50');
    expect(new Decimal(item.orderCommissionRatePct!).toString()).toBe('10');
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
      if (queriesBarcode(url, 'EAN13-UNKNOWN')) {
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

    // Cost-window rule (Berkin 2026-11-03): a past-day cost-missing order is persisted
    // PROFIT-EXCLUDED (LATE_UNCOSTED_ARRIVAL); the write still enqueues a recompute.
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.productVariantId).toBeNull();
    expect(item.barcode).toBe('EAN13-UNKNOWN');
  });

  it('cron intake: bilinmeyen barkod anında vendor sorgusuyla kataloğa eklenir', async () => {
    const { store, log } = await setupStoreAndSyncLog([]); // katalog boş

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (queriesBarcode(url, 'EAGER-CRON-1')) {
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
    // ORDER_DATE_MS is a past day; the order is persisted normally (phase 3B drops
    // the auto-exclusion) and the line is linked by product identity (visibility).
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id } },
    });
    expect(item.productVariantId).not.toBeNull();
  });

  it('cost-missing + past-day → persisted PROFIT-EXCLUDED, drained to EXCLUDED', async () => {
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

    // ORDER_DATE_MS is past-day and the cost is missing → persisted PROFIT-EXCLUDED
    // (LATE_UNCOSTED_ARRIVAL), not buffered.
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.organizationId).toBe(org.id);
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    // The write enqueued a recompute; draining it resolves the excluded order to an
    // EXCLUDED best-known statement (end-to-end order → queue → statement).
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const stmt = await prisma.orderProfitStatement.findFirst({
      where: { orderId: order.id, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(stmt?.status).toBe(ProfitStatus.EXCLUDED);
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

  it('raw commission rate: a line without commission stays null, a line with one stores it', async () => {
    const { store, log } = await setupStoreAndSyncLog(['EAN13-RATE-YES', 'EAN13-RATE-NO']);

    const withRate = makeShipmentPackage({
      shipmentPackageId: 3734026901,
      orderNumber: '11101228501',
      lines: [
        {
          lineId: 11,
          barcode: 'EAN13-RATE-YES',
          quantity: 1,
          lineUnitPrice: 120,
          lineGrossAmount: 120,
          lineSellerDiscount: 0,
          vatRate: 20,
          commission: 17,
        },
      ],
    });
    // The payload omits `commission` (the sparse-webhook shape).
    const withoutRate = makeShipmentPackage({
      shipmentPackageId: 3734026902,
      orderNumber: '11101228502',
      lines: [
        {
          lineId: 12,
          barcode: 'EAN13-RATE-NO',
          quantity: 1,
          lineUnitPrice: 120,
          lineGrossAmount: 120,
          lineSellerDiscount: 0,
          vatRate: 20,
        },
      ],
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        makeStreamResponse({ hasMore: false, nextCursor: null, content: [withRate, withoutRate] }),
      ),
    );
    await processOrdersChunk({ syncLog: log, cursor: null });

    const yesItem = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id, platformOrderId: '3734026901' } },
    });
    expect(new Decimal(yesItem.orderCommissionRatePct!).toString()).toBe('17');

    const noItem = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id, platformOrderId: '3734026902' } },
    });
    expect(noItem.orderCommissionRatePct).toBeNull();
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

  it('writes Order with GROSS convention + OrderItem gross columns', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-DIRECT']);

    // mapTrendyolShipmentPackage output mock'u (GROSS) — pure DB write doğrulaması.
    const mappedOrder = {
      platformOrderId: '99999',
      platformOrderNumber: 'TY-99',
      orderDate: new Date('2026-05-19T10:00:00Z'),
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      status: 'DELIVERED' as const,
      dematerialized: false,
      packagePending: false,
      saleGross: '120.00',
      saleVat: '20.00',
      listGross: '120.00',
      sellerDiscountGross: '0.00',
      promotionDisplays: null,
      agreedDeliveryDate: new Date('2026-05-20T00:00:00Z'),
      actualDeliveryDate: new Date('2026-05-19T18:00:00Z'),
      actualShipDate: new Date('2026-05-19T12:00:00Z'),
      fastDelivery: true,
      fastDeliveryType: 'FastDelivery',
      micro: false,
      estimatedDeliveryStartDate: new Date('2026-05-20T08:00:00Z'),
      estimatedDeliveryEndDate: new Date('2026-05-20T18:00:00Z'),
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
          lineListGross: '120.00',
          lineSaleGross: '120.00',
          lineSellerDiscountGross: '0.00',
          saleVatRate: '20',
          commissionRate: '10',
          categoryId: null,
          commissionKnown: true,
        },
      ],
    };

    await upsertOrderWithSnapshot(store.id, org.id, mappedOrder);

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('99999');
    expect(order.fastDelivery).toBe(true);
    expect(new Decimal(order.saleGross!).toString()).toBe('120');
    expect(new Decimal(order.saleVat!).toString()).toBe('20');
    // PR-8 cargo enrichment lands on CREATE.
    expect(order.cargoProviderName).toBe('Trendyol Express Marketplace');
    expect(order.cargoTrackingNumber).toBe(7330000167510333n);
    expect(new Decimal(order.cargoDeci!.toString()).toString()).toBe('2');
    expect(order.usesSellerCargoAgreement).toBe(false);
    expect(order.platformCreatedBy).toBe('order-creation');
    expect(order.originShipmentDate?.toISOString()).toBe('2026-05-19T09:00:00.000Z');
    // Fast-delivery type + estimated window capture (2026-06-14, hibrit tasarım).
    expect(order.fastDeliveryType).toBe('FastDelivery');
    expect(order.estimatedDeliveryStartDate?.toISOString()).toBe('2026-05-20T08:00:00.000Z');
    expect(order.estimatedDeliveryEndDate?.toISOString()).toBe('2026-05-20T18:00:00.000Z');
    expect(order.actualShipDate?.toISOString()).toBe('2026-05-19T12:00:00.000Z');

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(new Decimal(item.lineSaleGross).toString()).toBe('120');
    expect(new Decimal(item.orderCommissionRatePct!).toString()).toBe('10');
    expect(item.productVariantId).not.toBeNull();
    // PR-8 line trail.
    expect(item.platformLineId).toBe(10328256n);
    expect(item.barcode).toBe('EAN13-DIRECT');
  });

  it('fills the raw commission rate when a later event brings the commission', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-TWOPHASE']);

    // The first event carries no commission of its own -> the raw column stays null.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildDirectMapped({
        platformOrderId: 'twophase-1',
        barcode: 'EAN13-TWOPHASE',
        lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
        commissionKnown: false,
        commissionRate: '0',
      }),
    );
    const before = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id, platformOrderId: 'twophase-1' } },
    });
    expect(before.orderCommissionRatePct).toBeNull();

    // A newer event finally carries the line's own commission -> the raw column fills
    // on the existing item (no second item).
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildDirectMapped({
        platformOrderId: 'twophase-1',
        barcode: 'EAN13-TWOPHASE',
        lastModifiedDate: new Date('2026-05-19T12:00:00Z'),
        commissionKnown: true,
        commissionRate: '20',
      }),
    );
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(new Decimal(after.orderCommissionRatePct!).toString()).toBe('20');
    expect(await prisma.orderItem.count({ where: { orderId: before.orderId } })).toBe(1);
  });

  it('enqueues a profit recompute when an order is created or updated', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-ENQ']);
    const mapped = buildDirectMapped({
      platformOrderId: 'enq-1',
      barcode: 'EAN13-ENQ',
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
    });

    await upsertOrderWithSnapshot(store.id, org.id, mapped);
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'enq-1' },
    });
    const afterCreate = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(afterCreate?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);

    // Drain so the queue is empty, then a newer UPDATE must re-enqueue.
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(await prisma.profitRecomputeRequest.count({ where: { orderId: order.id } })).toBe(0);

    await upsertOrderWithSnapshot(store.id, org.id, {
      ...mapped,
      status: 'DELIVERED',
      lastModifiedDate: new Date('2026-05-19T13:00:00Z'),
    });
    const afterUpdate = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(afterUpdate?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
  });

  it('does not enqueue when an update carries the same lastModifiedDate', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-SAME-LMD']);
    const lmd = new Date('2026-05-19T11:00:00Z');
    const mapped = buildDirectMapped({
      platformOrderId: 'same-lmd',
      barcode: 'EAN13-SAME-LMD',
      lastModifiedDate: lmd,
    });

    await upsertOrderWithSnapshot(store.id, org.id, mapped);
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'same-lmd' },
    });
    // Drain the create's mark so the queue is empty before the re-delivery.
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(await prisma.profitRecomputeRequest.count({ where: { orderId: order.id } })).toBe(0);

    // A re-delivery carrying the SAME lastModifiedDate (the same event again, or the
    // 6-hourly ORDERS job re-reading an unchanged order) must not re-enqueue a recompute,
    // even though the idempotent upsert still runs.
    await upsertOrderWithSnapshot(store.id, org.id, { ...mapped, status: 'DELIVERED' });
    expect(await prisma.profitRecomputeRequest.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('does not enqueue when the freshness guard skips a stale event', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STALE']);
    const T1 = new Date('2026-05-19T10:00:00Z');
    const T2 = new Date('2026-05-19T12:00:00Z');

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildDirectMapped({
        platformOrderId: 'stale-guard',
        barcode: 'EAN13-STALE',
        status: 'SHIPPED',
        lastModifiedDate: T2,
      }),
    );
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(await prisma.profitRecomputeRequest.count({ where: { orderId: order.id } })).toBe(0);

    // A strictly-older event returns before any write — it enqueues nothing.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildDirectMapped({
        platformOrderId: 'stale-guard',
        barcode: 'EAN13-STALE',
        status: 'PROCESSING',
        lastModifiedDate: T1,
      }),
    );
    expect(await prisma.profitRecomputeRequest.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('captures the store profit settings on the order at creation only', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-SET']);
    await prisma.store.update({
      where: { id: store.id },
      data: { profitSettings: { includeStopaj: false, includeNegativeNetVat: true } },
    });
    const mapped = buildDirectMapped({
      platformOrderId: 'set-1',
      barcode: 'EAN13-SET',
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
    });

    await upsertOrderWithSnapshot(store.id, org.id, mapped);
    const created = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'set-1' },
    });
    expect(created.snapshotIncludeStopaj).toBe(false);
    expect(created.snapshotIncludeNegativeNetVat).toBe(true);

    // The store setting changes, then an UPDATE lands — the snapshot must not move
    // (snapshot-at-create; settings changes are forward-only).
    await prisma.store.update({
      where: { id: store.id },
      data: { profitSettings: { includeStopaj: true, includeNegativeNetVat: false } },
    });
    await upsertOrderWithSnapshot(store.id, org.id, {
      ...mapped,
      status: 'DELIVERED',
      lastModifiedDate: new Date('2026-05-19T13:00:00Z'),
    });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(updated.snapshotIncludeStopaj).toBe(false);
    expect(updated.snapshotIncludeNegativeNetVat).toBe(true);
  });

  it('enqueues on create and drains a fully-costed order to an ESTIMATED statement', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-EST']);
    // Full computability for the loader: the factory cost profile carries no version
    // row, so add one; plus a seeded shipping carrier and the variant's desi so the
    // shipping estimate resolves. Without all three the status would be NOT_COMPUTABLE.
    const carrier = await prisma.shippingCarrier.findFirstOrThrow({
      where: { platform: 'TRENDYOL', code: 'SENDEOMP' },
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultShippingCarrierId: carrier.id },
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-EST' },
    });
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { syncedDimensionalWeight: '1' },
    });
    const profile = await prisma.costProfile.findFirstOrThrow({
      where: { organizationId: org.id },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: org.id,
        version: 1,
        name: profile.name,
        type: profile.type,
        amountGross: profile.amountGross,
        vatRate: profile.vatRate,
        changedFields: [],
        changedAt: new Date('2024-01-01T00:00:00Z'),
      },
    });

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildDirectMapped({
        platformOrderId: 'est-1',
        barcode: 'EAN13-EST',
        lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      }),
    );
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'est-1' },
    });
    expect(
      (await prisma.profitRecomputeRequest.findUnique({ where: { orderId: order.id } }))?.reason,
    ).toBe(ProfitRecomputeReason.ORDER_CHANGED);

    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const stmt = await prisma.orderProfitStatement.findFirst({
      where: { orderId: order.id, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(stmt?.status).toBe(ProfitStatus.ESTIMATED);
  });

  it('sellerDiscountVat per-line GERÇEK saleVatRate ten türetilir — %10 satışta 1.00 (hardcoded %20 DEĞİL)', async () => {
    // Bug 2: sellerDiscountVat eskiden sellerDiscountGross × 20/120 ile sabit %20
    // varsayıyordu. %10 KDV oranlı ürünlerde (Türk bayrağı, kitap) bu yanlış değer
    // saklıyordu. Doğru: per-line lineSellerDiscountGross × saleVatRate/(100+saleVatRate).
    // %10 satır, indirim 11 → 11 × 10/110 = 1.00 (eski hatalı: 11 × 20/120 = 1.83).
    const { org, store } = await setupStoreAndSyncLog(['EAN13-VAT10']);

    const mappedOrder = {
      platformOrderId: '70010',
      platformOrderNumber: 'TY-VAT10',
      orderDate: new Date('2026-05-19T10:00:00Z'),
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      status: 'DELIVERED' as const,
      dematerialized: false,
      packagePending: false,
      // Satış 99 (KDV-dahil) = net 90 + %10 KDV 9; liste 110, indirim 11.
      saleGross: '99.00',
      saleVat: '9.00',
      listGross: '110.00',
      sellerDiscountGross: '11.00',
      promotionDisplays: null,
      agreedDeliveryDate: null,
      actualDeliveryDate: null,
      actualShipDate: null,
      fastDelivery: false,
      fastDeliveryType: null,
      micro: false,
      estimatedDeliveryStartDate: null,
      estimatedDeliveryEndDate: null,
      cargoProviderName: null,
      cargoTrackingNumber: null,
      cargoDeci: null,
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      originShipmentDate: null,
      lines: [
        {
          barcode: 'EAN13-VAT10',
          quantity: 1,
          platformLineId: '70010001',
          lineListGross: '110.00',
          lineSaleGross: '99.00',
          lineSellerDiscountGross: '11.00',
          // %10 satış KDV oranı — Bug 2'nin can alıcı noktası.
          saleVatRate: '10',
          commissionRate: '10',
          categoryId: null,
          commissionKnown: true,
        },
      ],
    };

    await upsertOrderWithSnapshot(store.id, org.id, mappedOrder);

    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: '70010' },
    });
    // 11 × 10/(100+10) = 1.00 (NOT 11 × 20/120 = 1.83).
    expect(new Decimal(order.sellerDiscountVat!).toString()).toBe('1');
    expect(new Decimal(order.sellerDiscountGross!).toString()).toBe('11');
  });

  it('sellerDiscountVat çok-satırlı: per-line oranlar karışık (%10 + %20) raw-aggregate', async () => {
    // İki satır: %10 oranlı indirim 11 → 1.00; %20 oranlı indirim 12 → 2.00. Toplam 3.00.
    // Karışık oran sabit %20 ile 11+12=23 × 20/120 = 3.83 verirdi (yanlış).
    const { org, store } = await setupStoreAndSyncLog(['EAN13-MIX-A', 'EAN13-MIX-B']);

    const mappedOrder = {
      platformOrderId: '70020',
      platformOrderNumber: 'TY-MIX',
      orderDate: new Date('2026-05-19T10:00:00Z'),
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      status: 'DELIVERED' as const,
      dematerialized: false,
      packagePending: false,
      saleGross: '209.00',
      saleVat: '21.00',
      listGross: '232.00',
      sellerDiscountGross: '23.00',
      promotionDisplays: null,
      agreedDeliveryDate: null,
      actualDeliveryDate: null,
      actualShipDate: null,
      fastDelivery: false,
      fastDeliveryType: null,
      micro: false,
      estimatedDeliveryStartDate: null,
      estimatedDeliveryEndDate: null,
      cargoProviderName: null,
      cargoTrackingNumber: null,
      cargoDeci: null,
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      originShipmentDate: null,
      lines: [
        {
          barcode: 'EAN13-MIX-A',
          quantity: 1,
          platformLineId: '70020001',
          lineListGross: '110.00',
          lineSaleGross: '99.00',
          lineSellerDiscountGross: '11.00',
          saleVatRate: '10', // %10 → 11 × 10/110 = 1.00
          commissionRate: '10',
          categoryId: null,
          commissionKnown: true,
        },
        {
          barcode: 'EAN13-MIX-B',
          quantity: 1,
          platformLineId: '70020002',
          lineListGross: '122.00',
          lineSaleGross: '110.00',
          lineSellerDiscountGross: '12.00',
          saleVatRate: '20', // %20 → 12 × 20/120 = 2.00
          commissionRate: '10',
          categoryId: null,
          commissionKnown: true,
        },
      ],
    };

    await upsertOrderWithSnapshot(store.id, org.id, mappedOrder);

    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: '70020' },
    });
    // 1.00 + 2.00 = 3.00 (sabit %20 yanlış değeri 3.83 verirdi).
    expect(new Decimal(order.sellerDiscountVat!).toString()).toBe('3');
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
      packagePending: false,
      saleGross: '120.00',
      saleVat: '20.00',
      listGross: '120.00',
      sellerDiscountGross: '0.00',
      promotionDisplays: null,
      agreedDeliveryDate: null,
      actualDeliveryDate: null,
      actualShipDate: null,
      fastDelivery: false,
      fastDeliveryType: null,
      micro: false,
      estimatedDeliveryStartDate: null,
      estimatedDeliveryEndDate: null,
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      lines: [
        {
          barcode: 'EAN13-DIRECT',
          quantity: 1,
          platformLineId: '10328999',
          lineListGross: '120.00',
          lineSaleGross: '120.00',
          lineSellerDiscountGross: '0.00',
          saleVatRate: '20',
          commissionRate: '10',
          categoryId: null,
          commissionKnown: true,
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
      // Shipped event sonraki sync'te geldi → actualShipDate null→non-null tazelenmeli.
      actualShipDate: new Date('2026-05-19T13:00:00Z'),
    });

    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: '99998' },
    });
    expect(order.cargoProviderName).toBe('Trendyol Express Marketplace');
    expect(order.cargoTrackingNumber).toBe(7330000167519999n);
    expect(new Decimal(order.cargoDeci!.toString()).toString()).toBe('3.5');
    expect(order.originShipmentDate?.toISOString()).toBe('2026-05-19T09:00:00.000Z');
    // actualShipDate ilk sync'te null'dı; ikinci sync'te (Shipped event) yazıldı.
    expect(order.actualShipDate?.toISOString()).toBe('2026-05-19T13:00:00.000Z');
  });
});

describe('upsertOrderWithSnapshot — out-of-order guard (freshness)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  const GUARD_BARCODE = 'EAN13-GUARD';
  // T1 < T2 — the marketplace lastModifiedDate of the older vs. newer event.
  const T1 = new Date('2026-05-19T10:00:00Z');
  const T2 = new Date('2026-05-19T12:00:00Z');

  function buildGuardMapped(over: {
    status: MappedOrder['status'];
    lastModifiedDate: Date;
    actualDeliveryDate?: Date | null;
  }): MappedOrder {
    return {
      platformOrderId: 'guard-1',
      platformOrderNumber: 'TY-GUARD',
      orderDate: new Date('2026-05-19T09:00:00Z'),
      lastModifiedDate: over.lastModifiedDate,
      status: over.status,
      dematerialized: false,
      packagePending: false,
      saleGross: '120.00',
      saleVat: '20.00',
      listGross: '120.00',
      sellerDiscountGross: '0.00',
      promotionDisplays: null,
      agreedDeliveryDate: null,
      actualDeliveryDate: over.actualDeliveryDate ?? null,
      actualShipDate: null,
      fastDelivery: false,
      fastDeliveryType: null,
      micro: false,
      estimatedDeliveryStartDate: null,
      estimatedDeliveryEndDate: null,
      cargoProviderName: null,
      cargoTrackingNumber: null,
      cargoDeci: null,
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      originShipmentDate: null,
      lines: [
        {
          barcode: GUARD_BARCODE,
          quantity: 1,
          platformLineId: '55501',
          lineListGross: '120.00',
          lineSaleGross: '120.00',
          lineSellerDiscountGross: '0.00',
          saleVatRate: '20',
          commissionRate: '10',
          categoryId: null,
          commissionKnown: true,
        },
      ],
    };
  }

  it('(a) stale event (older lastModifiedDate) is dropped — no status regression, watermark stays', async () => {
    const { org, store } = await setupStoreAndSyncLog([GUARD_BARCODE]);

    // Fresh event at T2 → status SHIPPED, watermark stamped at T2.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'SHIPPED', lastModifiedDate: T2 }),
    );
    // Stale older event (T1 < T2) tries to regress the status back to PROCESSING.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'PROCESSING', lastModifiedDate: T1 }),
    );

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    // Guard dropped the whole write — status and watermark are untouched.
    expect(order.status).toBe('SHIPPED');
    expect(order.platformLastModifiedAt?.toISOString()).toBe(T2.toISOString());
  });

  it('(b) newer event is applied and advances the watermark', async () => {
    const { org, store } = await setupStoreAndSyncLog([GUARD_BARCODE]);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'PROCESSING', lastModifiedDate: T1 }),
    );
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'SHIPPED', lastModifiedDate: T2 }),
    );

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.status).toBe('SHIPPED');
    expect(order.platformLastModifiedAt?.toISOString()).toBe(T2.toISOString());
  });

  it('(c) legacy row with a null watermark accepts the incoming event regardless of its timestamp', async () => {
    const { org, store } = await setupStoreAndSyncLog([GUARD_BARCODE]);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'SHIPPED', lastModifiedDate: T2 }),
    );
    // Simulate a legacy row: clear the watermark the create just stamped.
    await prisma.order.updateMany({
      where: { storeId: store.id },
      data: { platformLastModifiedAt: null },
    });

    // Even an OLDER event (T1 < T2) is applied — there is no watermark to compare.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'DELIVERED', lastModifiedDate: T1, actualDeliveryDate: T1 }),
    );

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.status).toBe('DELIVERED');
    expect(order.platformLastModifiedAt?.toISOString()).toBe(T1.toISOString());
  });

  it('(d) same lastModifiedDate re-delivery is applied (equality passes → idempotent upsert)', async () => {
    const { org, store } = await setupStoreAndSyncLog([GUARD_BARCODE]);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'SHIPPED', lastModifiedDate: T2 }),
    );
    // Same watermark, a status the re-delivery carries — equality must NOT block it.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildGuardMapped({ status: 'DELIVERED', lastModifiedDate: T2, actualDeliveryDate: T2 }),
    );

    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.status).toBe('DELIVERED');
    expect(order.platformLastModifiedAt?.toISOString()).toBe(T2.toISOString());
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
    // A prior COMPLETED ORDERS sync (with a stamped completedAt) flips the
    // handler into delta mode. completedAt ≈ now → the safety-net floor still
    // wins, so the window floor is now − 8h (asserted below).
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'ORDERS',
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
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

describe('upsertOrderWithSnapshot — optimistic stock decrement (product freshness)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  // A real instant that falls squarely inside TODAY's business day, so the
  // business-today decrement gate (upsert-order.ts) fires deterministically.
  // Mid-day avoids the midnight boundary a raw `new Date()` could straddle
  // between the fixture build and the write.
  function todayInstant(): Date {
    return new Date(getBusinessDayRange().start.getTime() + 12 * MS_HOUR);
  }

  // Compact MappedOrder builder for stock cases — mirrors the direct-call block's
  // GROSS shape but lets each test drive per-line barcode/quantity/lineId. The
  // optimistic decrement only fires for a TODAY-dated order, so orderDate defaults
  // to today; the past-day case passes an explicit historical date to prove the
  // gate skips it.
  function buildStockMapped(args: {
    platformOrderId: string;
    lines: Array<{ barcode: string; quantity: number; platformLineId: string }>;
    orderDate?: Date;
  }): MappedOrder {
    return {
      platformOrderId: args.platformOrderId,
      platformOrderNumber: `TY-${args.platformOrderId}`,
      orderDate: args.orderDate ?? todayInstant(),
      lastModifiedDate: new Date('2026-05-19T11:00:00Z'),
      status: 'PROCESSING',
      dematerialized: false,
      packagePending: false,
      saleGross: '120.00',
      saleVat: '20.00',
      listGross: '120.00',
      sellerDiscountGross: '0.00',
      promotionDisplays: null,
      agreedDeliveryDate: null,
      actualDeliveryDate: null,
      actualShipDate: null,
      fastDelivery: false,
      fastDeliveryType: null,
      micro: false,
      estimatedDeliveryStartDate: null,
      estimatedDeliveryEndDate: null,
      cargoProviderName: null,
      cargoTrackingNumber: null,
      cargoDeci: null,
      usesSellerCargoAgreement: false,
      platformCreatedBy: 'order-creation',
      originShipmentDate: null,
      lines: args.lines.map((line) => ({
        barcode: line.barcode,
        quantity: line.quantity,
        platformLineId: line.platformLineId,
        lineListGross: '120.00',
        lineSaleGross: '120.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '20',
        commissionRate: '10',
        categoryId: null,
        commissionKnown: true,
      })),
    };
  }

  // setupStoreAndSyncLog seeds variants at the quantity=0 default, so tests set a
  // known starting stock (variant.quantity + the denormalized Product.totalStock)
  // before exercising the decrement.
  async function seedStock(storeId: string, barcode: string, quantity: number): Promise<void> {
    await prisma.productVariant.updateMany({ where: { storeId, barcode }, data: { quantity } });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { storeId, barcode } });
    const total = await prisma.productVariant.aggregate({
      where: { productId: variant.productId },
      _sum: { quantity: true },
    });
    await prisma.product.update({
      where: { id: variant.productId },
      data: { totalStock: total._sum.quantity ?? 0 },
    });
  }

  it('(a) first insert decrements variant quantity + Product.totalStock; floors at 0 when line qty exceeds stock', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STOCK-OK', 'EAN13-STOCK-FLOOR']);
    await seedStock(store.id, 'EAN13-STOCK-OK', 10);
    await seedStock(store.id, 'EAN13-STOCK-FLOOR', 2);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildStockMapped({
        platformOrderId: 'stock-a',
        lines: [
          { barcode: 'EAN13-STOCK-OK', quantity: 3, platformLineId: '9001' },
          { barcode: 'EAN13-STOCK-FLOOR', quantity: 5, platformLineId: '9002' },
        ],
      }),
    );

    const ok = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-OK' },
    });
    expect(ok.quantity).toBe(7); // 10 − 3
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: ok.productId } })).totalStock,
    ).toBe(7);

    const floor = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-FLOOR' },
    });
    expect(floor.quantity).toBe(0); // GREATEST(2 − 5, 0) — floored, never negative
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: floor.productId } })).totalStock,
    ).toBe(0);
  });

  it('(b) re-sync of the same order does not decrement a second time', async () => {
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STOCK-RESYNC']);
    await seedStock(store.id, 'EAN13-STOCK-RESYNC', 10);
    const mapped = buildStockMapped({
      platformOrderId: 'stock-b',
      lines: [{ barcode: 'EAN13-STOCK-RESYNC', quantity: 2, platformLineId: '9101' }],
    });

    await upsertOrderWithSnapshot(store.id, org.id, mapped); // 10 → 8
    // Same lastModifiedDate → equality passes the freshness guard, the line hits
    // the existing-item `continue` branch → no second decrement.
    await upsertOrderWithSnapshot(store.id, org.id, mapped);

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-RESYNC' },
    });
    expect(variant.quantity).toBe(8); // still one decrement, not 6
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: variant.productId } })).totalStock,
    ).toBe(8);
  });

  it('(c) decrement targets only the matched variant — an unrelated sibling variant and an unmatched line are untouched', async () => {
    // Seed a matching variant (referenced by the order) alongside an unrelated
    // sibling variant (a catalog neighbor NOT in the order). The decrement must
    // hit only the matched variant; the sibling's quantity must be identical
    // afterwards, proving the movement is scoped to the resolved line's variant
    // and never spills to other catalog rows. An unknown-barcode line rides along
    // to re-assert that an unmatched line persists (barcode trail, null FK) and
    // moves no stock.
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STOCK-MATCH', 'EAN13-STOCK-SIBLING']);
    await seedStock(store.id, 'EAN13-STOCK-MATCH', 10);
    await seedStock(store.id, 'EAN13-STOCK-SIBLING', 7);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildStockMapped({
        platformOrderId: 'stock-c',
        lines: [
          { barcode: 'EAN13-STOCK-MATCH', quantity: 3, platformLineId: '9201' },
          { barcode: 'EAN13-UNKNOWN-C', quantity: 4, platformLineId: '9202' },
        ],
      }),
    );

    // Matched variant decremented (10 − 3 = 7) + its denormalized totalStock.
    const matched = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-MATCH' },
    });
    expect(matched.quantity).toBe(7);
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: matched.productId } })).totalStock,
    ).toBe(7);

    // Unrelated sibling variant is untouched — no spill from the matched line.
    const sibling = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-SIBLING' },
    });
    expect(sibling.quantity).toBe(7); // unchanged from its seeded 7
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: sibling.productId } })).totalStock,
    ).toBe(7);

    // The unmatched line still persists (barcode trail) with a null variant FK,
    // moving no stock.
    const unmatched = await prisma.orderItem.findFirstOrThrow({
      where: {
        order: { storeId: store.id, platformOrderId: 'stock-c' },
        barcode: 'EAN13-UNKNOWN-C',
      },
    });
    expect(unmatched.productVariantId).toBeNull();
  });

  it('(d) past-day first insert does NOT decrement — bootstrap/backfill leaves stock to the scans', async () => {
    // A freshly connected store's bootstrap ORDERS sync (window [createdAt, now])
    // and dev/stage backfills first-insert historical orders. The optimistic
    // decrement mirrors LIVE sales only, so a past-business-day order must leave
    // catalog stock untouched — the authoritative catalog scan owns it.
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STOCK-PAST']);
    await seedStock(store.id, 'EAN13-STOCK-PAST', 10);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildStockMapped({
        platformOrderId: 'stock-d',
        orderDate: new Date('2026-05-19T10:00:00Z'), // explicit past business day
        lines: [{ barcode: 'EAN13-STOCK-PAST', quantity: 3, platformLineId: '9301' }],
      }),
    );

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-PAST' },
    });
    expect(variant.quantity).toBe(10); // unchanged — no live decrement for a past-day order
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: variant.productId } })).totalStock,
    ).toBe(10);
  });

  it('(e) a buffer graduation (promotedFromBuffer) does NOT decrement — the buffered intake already did', async () => {
    // Owner ruling 2026-07-11: the optimistic decrement fires at buffer INTAKE, so
    // a buffer→orders promotion (promotedFromBuffer=true) must NOT decrement again
    // or the same units drop twice. This is the SAME today-dated order that case
    // (a) decrements on a direct insert — only the flag differs.
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STOCK-PROMO']);
    await seedStock(store.id, 'EAN13-STOCK-PROMO', 10);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildStockMapped({
        platformOrderId: 'stock-e',
        lines: [{ barcode: 'EAN13-STOCK-PROMO', quantity: 3, platformLineId: '9401' }],
      }),
      undefined,
      { promotedFromBuffer: true },
    );

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-PROMO' },
    });
    expect(variant.quantity).toBe(10); // unchanged — the graduation moves no stock
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: variant.productId } })).totalStock,
    ).toBe(10);
    // But it IS a graduation — the promotion marker is stamped.
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'stock-e' },
    });
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('(f) the aggregate refresh after a decrement counts only in-scope variants (an archived sibling stays out)', async () => {
    // Product aggregates follow the default listing scope (listed, not archived):
    // re-aggregating after the decrement must not add an archived sibling's
    // stock back into Product.totalStock.
    const { org, store } = await setupStoreAndSyncLog(['EAN13-STOCK-SCOPE']);
    await seedStock(store.id, 'EAN13-STOCK-SCOPE', 10);
    const matched = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: 'EAN13-STOCK-SCOPE' },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: matched.productId,
        platformVariantId: BigInt(9_900_001),
        barcode: 'EAN13-STOCK-ARCHIVED',
        stockCode: 'sk-EAN13-STOCK-ARCHIVED',
        salePrice: '100',
        listPrice: '120',
        quantity: 50,
        status: ProductVariantStatus.ARCHIVED,
      },
    });

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildStockMapped({
        platformOrderId: 'stock-f',
        lines: [{ barcode: 'EAN13-STOCK-SCOPE', quantity: 3, platformLineId: '9501' }],
      }),
    );

    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: matched.id } });
    expect(after.quantity).toBe(7); // 10 - 3
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: matched.productId } })).totalStock,
    ).toBe(7); // the archived sibling's 50 units stay out
  });
});
