// Variant-resolution tick integration tests (variant-recovery PR-2).
//
// Real DB. The vendor side is the ONLY thing mocked (global.fetch spy):
// (1) local catalog match links without any vendor call;
// (2) a missing barcode is fetched from Trendyol with the targeted
//     single-barcode query and lands through the SAME products upsert
//     pipeline, then the line links + cost/profit re-entry fires;
// (3) a barcode the vendor does not know advances attempts + backoff.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder } from '@pazarsync/order-sync';
import { encryptCredentials } from '@pazarsync/sync-core';

import { processVariantResolution } from '../../src/handlers/variant-resolution';

import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const SANDBOX_BASE = 'https://stageapigw.trendyol.test';
const SUPPLIER_ID = '2738';

interface BuiltCtx {
  organizationId: string;
  storeId: string;
  orderId: string;
  /** One id per requested barcode, same order. */
  itemIds: string[];
  /** Convenience for the single-barcode callers. */
  itemId: string;
}

/** Org + SANDBOX store (real encrypted creds). */
async function buildStore(): Promise<{ organizationId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Resolution Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
      status: 'ACTIVE',
    },
  });
  return { organizationId: org.id, storeId: store.id };
}

/** Order with one unresolved (null-variant) item per barcode, in the given store. */
async function buildUnresolvedOrder(
  ctx: { organizationId: string; storeId: string },
  barcodes: string[],
): Promise<{ orderId: string; itemIds: string[] }> {
  const order = await prisma.order.create({
    data: {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      platformOrderId: `pkg-${randomUUID().slice(0, 8)}`,
      platformOrderNumber: `ord-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'PROCESSING',
      saleSubtotalNet: new Decimal('100.00'),
      saleVatTotal: new Decimal('20.00'),
    },
  });

  const itemIds: string[] = [];
  for (const barcode of barcodes) {
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: ctx.organizationId,
        productVariantId: null,
        barcode,
        platformLineId: BigInt(Math.floor(Math.random() * 1_000_000)),
        quantity: 1,
        unitPrice: new Decimal('120.00'),
        commissionRate: new Decimal('10.00'),
        commissionAmount: new Decimal('12.00'),
        unitPriceNet: new Decimal('100.00'),
        unitVatRate: new Decimal('20.00'),
        unitVatAmount: new Decimal('20.00'),
      },
    });
    itemIds.push(item.id);
  }
  return { orderId: order.id, itemIds };
}

/** Org + store + order with ONE unresolved item (the original single-barcode shape). */
async function buildUnresolvedScenario(barcode: string): Promise<BuiltCtx> {
  const storeCtx = await buildStore();
  const { orderId, itemIds } = await buildUnresolvedOrder(storeCtx, [barcode]);
  return { ...storeCtx, orderId, itemIds, itemId: itemIds[0]! };
}

const PAST_DAY_MS = 36 * 60 * 60 * 1000;

/** MappedOrder for the REAL intake path (single line, given barcode). */
function buildMappedOrder(args: {
  platformOrderId: string;
  orderDate: Date;
  barcode: string;
}): MappedOrder {
  return {
    platformOrderId: args.platformOrderId,
    platformOrderNumber: `ord-${args.platformOrderId}`,
    orderDate: args.orderDate,
    lastModifiedDate: args.orderDate,
    status: 'PROCESSING',
    dematerialized: false,
    saleSubtotalNet: '84.75',
    saleVatTotal: '15.25',
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    fastDelivery: false,
    micro: false,
    cargoProviderName: null,
    cargoTrackingNumber: null,
    cargoDeci: null,
    usesSellerCargoAgreement: false,
    platformCreatedBy: null,
    originShipmentDate: null,
    lines: [
      {
        barcode: args.barcode,
        quantity: 1,
        platformLineId: '6001',
        unitPriceNet: '84.75',
        unitVatRate: '18',
        unitVatAmount: '15.25',
        grossCommissionAmountNet: '12.71',
        grossCommissionVatAmount: '2.29',
        sellerDiscountNet: '0',
        sellerDiscountVatAmount: '0',
        commissionRate: '15',
      },
    ],
  };
}

/** Catalog variant for (storeId, barcode); optionally with an active cost profile. */
async function seedCatalogVariant(
  orgId: string,
  storeId: string,
  barcode: string,
  withCost: boolean,
): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Resolution Catalog Product',
    },
  });
  const costLink = withCost
    ? {
        costProfileLinks: {
          create: {
            organizationId: orgId,
            profileId: (await createCostProfile(orgId, { amount: '40.00' })).id,
          },
        },
      }
    : {};
  await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      ...costLink,
    },
  });
}

/** Real approved-products wire fixture (same shape the full catalog sync maps). */
function approvedProductsResponse(barcode: string, count: number): unknown {
  return {
    totalElements: count,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: Array.from({ length: count }, (_, i) => ({
      contentId: 700_000 + i,
      productMainId: `pmid-${barcode}`,
      brand: { id: 1, name: 'Brand' },
      category: { id: 1, name: 'Category' },
      creationDate: 1777246115403,
      lastModifiedDate: 1777246115403,
      title: 'Vendor Product',
      description: 'desc',
      images: [{ url: 'https://cdn.example.com/x.jpg' }],
      attributes: [],
      variants: [
        {
          variantId: 7_000_000 + i,
          supplierId: Number(SUPPLIER_ID),
          barcode,
          attributes: [],
          onSale: true,
          deliveryOptions: { deliveryDuration: 1, isRushDelivery: false, fastDeliveryOptions: [] },
          stock: { quantity: 5, lastModifiedDate: 0 },
          price: { salePrice: 100, listPrice: 120 },
          stockCode: `sk-${barcode}`,
          vatRate: 20,
          locked: false,
          archived: false,
          blacklisted: false,
        },
      ],
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('processVariantResolution', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', SANDBOX_BASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('links an unresolved item from the local catalog (no vendor call) and re-enters cost/profit', async () => {
    const ctx = await buildUnresolvedScenario('BC-LOCAL-1');
    await seedCatalogVariant(ctx.organizationId, ctx.storeId, 'BC-LOCAL-1', true);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('vendor must NOT be called when the local catalog already matches');
    });

    await processVariantResolution();

    expect(fetchSpy).not.toHaveBeenCalled();
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(item.productVariantId).not.toBeNull();
    // Cost re-entry: the linked variant carries an active cost profile.
    expect(item.unitCostSnapshotNet).not.toBeNull();
  });

  it('fetches a missing barcode from the vendor, upserts the catalog row, and links', async () => {
    const ctx = await buildUnresolvedScenario('BC-VENDOR-2');

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith(SANDBOX_BASE) && url.includes('barcode=BC-VENDOR-2')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-VENDOR-2', 1)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    await processVariantResolution();

    expect(
      await prisma.productVariant.count({
        where: { storeId: ctx.storeId, barcode: 'BC-VENDOR-2' },
      }),
    ).toBe(1);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(item.productVariantId).not.toBeNull();
    // Attempts untouched on success — the row leaves the queue by linking.
    expect(item.variantResolutionAttempts).toBe(0);

    // Post-success idempotency: a second tick must not re-query the vendor
    // (the linked row left the queue via the productVariantId filter) and
    // must leave the row byte-identical.
    const fetchCallsAfterFirstTick = vi.mocked(globalThis.fetch).mock.calls.length;
    await processVariantResolution();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(fetchCallsAfterFirstTick);
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(after.variantResolutionAttempts).toBe(0);
    expect(after.productVariantId).toBe(item.productVariantId);
  });

  it('advances attempts + exponential backoff when the vendor knows no such barcode', async () => {
    const ctx = await buildUnresolvedScenario('BC-GONE-3');

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith(SANDBOX_BASE) && url.includes('barcode=BC-GONE-3')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-GONE-3', 0)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    const beforeFirstTick = Date.now();
    await processVariantResolution();

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(item.productVariantId).toBeNull();
    expect(item.variantResolutionAttempts).toBe(1);
    // First failure: deadline keyed off the OLD attempts value (0) → 5 min base.
    const firstDelay = item.nextResolutionAt!.getTime() - beforeFirstTick;
    expect(firstDelay).toBeGreaterThanOrEqual(4.5 * 60_000);
    expect(firstDelay).toBeLessThanOrEqual(5.5 * 60_000);

    // A second tick BEFORE the backoff deadline must not touch the row again.
    await processVariantResolution();
    const untouched = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(untouched.variantResolutionAttempts).toBe(1);

    // Force the deadline into the past → second REAL failure doubles the
    // delay (5 min × 2¹ = 10 min) — pins the exponential growth.
    await prisma.orderItem.update({
      where: { id: ctx.itemId },
      data: { nextResolutionAt: new Date(Date.now() - 1000) },
    });
    const beforeSecondTick = Date.now();
    await processVariantResolution();
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(after.variantResolutionAttempts).toBe(2);
    const secondDelay = after.nextResolutionAt!.getTime() - beforeSecondTick;
    expect(secondDelay).toBeGreaterThanOrEqual(9 * 60_000);
    expect(secondDelay).toBeLessThanOrEqual(11 * 60_000);
  });

  it('full pipeline: late-arrival intake persists EXCLUDED; tick links identity, money stays frozen', async () => {
    const ctx = await buildStore();

    // REAL intake path (spec 2026-06-12): past-day order with an unknown
    // barcode → persisted PROFIT-EXCLUDED — no fees, no estimate, ever.
    const outcome = await intakeOrder({
      storeId: ctx.storeId,
      organizationId: ctx.organizationId,
      mapped: buildMappedOrder({
        platformOrderId: 'feededup-1',
        orderDate: new Date(Date.now() - PAST_DAY_MS),
        barcode: 'BC-FEEDEDUP',
      }),
    });
    expect(outcome).toEqual({ kind: 'persisted', reason: 'excluded_late_arrival' });
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: ctx.storeId, platformOrderId: 'feededup-1' },
    });
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    expect(await prisma.orderFee.count({ where: { orderId: order.id } })).toBe(0);

    // Catalog catches up (variant + cost profile) → tick links IDENTITY only
    // (görünürlük sözleşmesi): money re-entry is skipped on excluded orders.
    await seedCatalogVariant(ctx.organizationId, ctx.storeId, 'BC-FEEDEDUP', true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('vendor must NOT be called — local catalog has the barcode');
    });

    await processVariantResolution();

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.productVariantId).not.toBeNull(); // kimlik bağlandı (görünürlük)
    expect(item.unitCostSnapshotNet).toBeNull(); // para donuk
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.estimatedNetProfit).toBeNull();
    expect(await prisma.orderFee.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('kâr-dışı siparişin kalemi KİMLİK için bağlanır ama para alanları donuk kalır', async () => {
    const ctx = await buildStore();
    const { orderId, itemIds } = await buildUnresolvedOrder(ctx, ['BC-FROZEN-1']);
    await prisma.order.update({
      where: { id: orderId },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });
    await seedCatalogVariant(ctx.organizationId, ctx.storeId, 'BC-FROZEN-1', true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('vendor cagrisi olmamali — yerel katalog dolu');
    });

    await processVariantResolution();

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemIds[0]! } });
    expect(item.productVariantId).not.toBeNull(); // kimlik bağlandı (görünürlük)
    expect(item.unitCostSnapshotNet).toBeNull(); // para donuk
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).toBeNull();
    expect(await prisma.orderFee.count({ where: { orderId } })).toBe(0);
  });

  it('partial link on a multi-item order: estimate stays null until EVERY line is costed', async () => {
    const ctx = await buildStore();
    const { orderId, itemIds } = await buildUnresolvedOrder(ctx, ['BC-PART-A', 'BC-PART-B']);
    await seedCatalogVariant(ctx.organizationId, ctx.storeId, 'BC-PART-A', true);

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith(SANDBOX_BASE) && url.includes('barcode=BC-PART-B')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-PART-B', 0)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    await processVariantResolution();

    const [itemA, itemB] = await Promise.all(
      itemIds.map((id) => prisma.orderItem.findUniqueOrThrow({ where: { id } })),
    );
    expect(itemA!.productVariantId).not.toBeNull();
    expect(itemA!.unitCostSnapshotNet).not.toBeNull();
    expect(itemB!.productVariantId).toBeNull();
    expect(itemB!.variantResolutionAttempts).toBe(1);
    // The money invariant: a half-costed order NEVER gets a profit number.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).toBeNull();

    // The sibling resolves later (with cost) → estimate completes.
    await seedCatalogVariant(ctx.organizationId, ctx.storeId, 'BC-PART-B', true);
    await prisma.orderItem.update({
      where: { id: itemIds[1]! },
      data: { nextResolutionAt: new Date(Date.now() - 1000) },
    });
    await processVariantResolution();
    const completed = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(completed.estimatedNetProfit).not.toBeNull();
  });

  it('per-store isolation: one store failing on the vendor neither blocks nor leaves the other hot-looping', async () => {
    const broken = await buildUnresolvedScenario('BC-BROKEN-X');
    const healthy = await buildUnresolvedScenario('BC-HEALTHY-Y');

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('barcode=BC-BROKEN-X')) {
        // 401 → MarketplaceAuthError: fail-FAST (5xx'in retry+sleep döngüsü
        // test timeout'una çarpar; izolasyon davranışı için throw yeterli).
        return Promise.resolve(new Response('bad credentials', { status: 401 }));
      }
      if (url.includes('barcode=BC-HEALTHY-Y')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-HEALTHY-Y', 1)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    await processVariantResolution();

    // Healthy store linked despite the sibling store's 5xx.
    const healthyItem = await prisma.orderItem.findUniqueOrThrow({
      where: { id: healthy.itemId },
    });
    expect(healthyItem.productVariantId).not.toBeNull();
    // Broken store's items took a backoff (no 60s hot-loop, window vacated).
    const brokenItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: broken.itemId } });
    expect(brokenItem.productVariantId).toBeNull();
    expect(brokenItem.variantResolutionAttempts).toBe(1);
    expect(brokenItem.nextResolutionAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('same barcode across two orders: ONE vendor call, BOTH items linked', async () => {
    const ctx = await buildStore();
    const first = await buildUnresolvedOrder(ctx, ['BC-DUP']);
    const second = await buildUnresolvedOrder(ctx, ['BC-DUP']);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith(SANDBOX_BASE) && url.includes('barcode=BC-DUP')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-DUP', 1)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    await processVariantResolution();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const items = await prisma.orderItem.findMany({
      where: { id: { in: [first.itemIds[0]!, second.itemIds[0]!] } },
    });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.productVariantId !== null)).toBe(true);
    expect(items.every((i) => i.variantResolutionAttempts === 0)).toBe(true);
  });
});
