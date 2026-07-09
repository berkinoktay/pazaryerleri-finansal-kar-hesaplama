// Integration tests for the commission fallback + next-webhook refresh behavior
// implemented in `packages/order-sync/src/upsert-order.ts`
// (`resolveEffectiveCommission` on CREATE + the existing-item refresh block).
//
// Money-adjacent fix: when a Trendyol webhook carries no commission on a line
// (`commissionKnown === false`, the sparse-payload prod case), the order-item
// commission must NOT freeze at the defensive 0 — it falls back to the DB
// category `base_rate` (via `resolveCommissionRate`, sellerSegment=null). A
// later webhook carrying the real commission refreshes the estimate-side
// columns (unless a settlement has already written `settledCommissionGross`),
// and the freshness guard drops any strictly-older event before it can regress
// a fresher one.
//
// Scenarios:
//   1. Fallback (direct/calculable): 0-commission line -> category base_rate 19.
//   2. Refresh: a newer webhook with the real commission updates the item + estimate.
//   3. Fresh == buffer: the direct-calculable and buffer->promote paths agree.
//   4. Stale never wins: an older lastModifiedDate is dropped by the freshness guard.
//   5. Settled preserved: a non-null settledCommissionGross blocks the refresh.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder, upsertOrderWithSnapshot } from '@pazarsync/order-sync';

import { processBufferPromote } from '../../src/handlers/buffer-promote';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createCostProfile,
  createOrganization,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

// The test category: 626 -> base_rate 19% (sellerSegment=null path). BigInt on the
// wire (matches the Trendyol categoryId int64 shape) but stringified on the line.
const CATEGORY_ID = '626';
const BASE_RATE = '19';
const BARCODE = 'EAN13-COMM-001';

// Reference row for the fallback lookup. `marketplace_commission_rate` IS in the
// truncateAll wipe list, so this is re-seeded fresh in every beforeEach (mirrors
// the resolver test) — no cross-test pollution, every test starts with one row.
async function seedCommissionRate(): Promise<void> {
  await prisma.marketplaceCommissionRate.create({
    data: {
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      categoryId: BigInt(CATEGORY_ID),
      brandId: null,
      categoryName: 'Test Category 626',
      parentCategoryName: 'Test Parent',
      brandName: null,
      baseRate: new Decimal(BASE_RATE),
      paymentTermDays: 60,
      fetchedAt: new Date(),
      sourceScreen: 'CategoryCommissionPaymentTerms',
    },
  });
}

// A single-line MappedOrder. Every scenario shares the same money shape (600 sale,
// 20% VAT, 200 cost) so the profit engine result is deterministic; only the
// commission fields + lastModifiedDate vary per event.
function buildMapped(over: {
  platformOrderId: string;
  barcode?: string;
  commissionKnown: boolean;
  categoryId: string | null;
  commissionRate: string;
  commissionGross: string;
  refundedCommissionGross?: string;
  // orderDate must be TODAY for the buffer path (intakeOrder past-day routing);
  // the direct upsert path ignores it. Defaults to now().
  orderDate?: Date;
  lastModifiedDate?: Date;
}): MappedOrder {
  const orderDate = over.orderDate ?? new Date();
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: `ord-${over.platformOrderId}`,
    orderDate,
    lastModifiedDate: over.lastModifiedDate ?? orderDate,
    status: 'PROCESSING',
    dematerialized: false,
    // GROSS convention: saleGross 600 = net 500 + VAT 100 (20% inclusive).
    saleGross: '600.00',
    saleVat: '100.00',
    listGross: '600.00',
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
    platformCreatedBy: null,
    originShipmentDate: null,
    lines: [
      {
        barcode: over.barcode ?? BARCODE,
        quantity: 1,
        platformLineId: '7001',
        lineListGross: '600.00',
        lineSaleGross: '600.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '20',
        commissionRate: over.commissionRate,
        commissionGross: over.commissionGross,
        refundedCommissionGross: over.refundedCommissionGross ?? '0.00',
        commissionVatRate: '20',
        categoryId: over.categoryId,
        commissionKnown: over.commissionKnown,
      },
    ],
  };
}

// Seed a product + variant. withCost=true attaches a 200 cost profile so the
// order is calculable; withCost=false leaves it cost-missing (buffer route).
async function seedVariant(
  orgId: string,
  storeId: string,
  barcode: string,
  withCost: boolean,
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Commission Test Product',
    },
  });
  const costLink = withCost
    ? {
        costProfileLinks: {
          create: {
            organizationId: orgId,
            profileId: (await createCostProfile(orgId, { amountGross: '200.00' })).id,
          },
        },
      }
    : {};
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '600',
      listPrice: '600',
      ...costLink,
    },
  });
  return variant.id;
}

// Attach a 200 cost profile to an already-seeded variant (buffer -> promote flip).
async function attachCost(orgId: string, variantId: string): Promise<void> {
  const profile = await createCostProfile(orgId, { amountGross: '200.00' });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: orgId, productVariantId: variantId, profileId: profile.id },
  });
}

describe('commission fallback + next-webhook refresh', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    await seedCommissionRate();
  });

  it('fallback: commissionKnown=false + categoryId -> category base_rate (not 0), estimate includes it', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    await seedVariant(org.id, store.id, BARCODE, true);

    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'fallback-1',
        commissionKnown: false,
        categoryId: CATEGORY_ID,
        commissionRate: '0',
        commissionGross: '0.00',
      }),
    );

    const item = await prisma.orderItem.findFirstOrThrow({
      where: {
        organizationId: org.id,
        order: { storeId: store.id, platformOrderId: 'fallback-1' },
      },
    });
    // Commission is NOT the defensive 0 — category base_rate 19 was applied.
    expect(new Decimal(item.commissionRate).toString()).toBe('19');
    // 600 (lineListGross) x 19 / 100 = 114.00.
    expect(new Decimal(item.commissionGross).toFixed(2)).toBe('114.00');
    // The T+0 estimate copy carries the fallback commission, not 0.
    expect(item.estimatedCommissionGross).not.toBeNull();
    expect(new Decimal(item.estimatedCommissionGross!).toFixed(2)).toBe('114.00');

    const order = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'fallback-1' },
    });
    // Estimate computed (not null) and it deducted the commission + fees:
    // strictly below saleNet(500) - costNet(166.67) = 333.33.
    expect(order.estimatedNetProfit).not.toBeNull();
    expect(new Decimal(order.estimatedNetProfit!).lt(new Decimal('333.33'))).toBe(true);
  });

  it('refresh: a newer webhook carrying the real commission updates the item + estimate', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    await seedVariant(org.id, store.id, BARCODE, true);

    const t1 = new Date('2026-07-08T08:00:00.000Z');
    const t2 = new Date('2026-07-08T12:00:00.000Z');

    // First webhook carries no commission -> fallback 114.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'refresh-1',
        commissionKnown: false,
        categoryId: CATEGORY_ID,
        commissionRate: '0',
        commissionGross: '0.00',
        lastModifiedDate: t1,
      }),
    );
    const before = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'refresh-1' },
    });
    const beforeItem = await prisma.orderItem.findFirstOrThrow({
      where: { organizationId: org.id, orderId: before.id },
    });
    expect(new Decimal(beforeItem.commissionGross).toFixed(2)).toBe('114.00');
    expect(before.estimatedNetProfit).not.toBeNull();

    // Next webhook carries the real commission (20% -> gross 120), newer lmd.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'refresh-1',
        commissionKnown: true,
        categoryId: CATEGORY_ID,
        commissionRate: '20',
        commissionGross: '120.00',
        lastModifiedDate: t2,
      }),
    );

    const afterItem = await prisma.orderItem.findFirstOrThrow({
      where: { organizationId: org.id, orderId: before.id },
    });
    expect(new Decimal(afterItem.commissionRate).toString()).toBe('20');
    expect(new Decimal(afterItem.commissionGross).toFixed(2)).toBe('120.00');
    expect(new Decimal(afterItem.estimatedCommissionGross!).toFixed(2)).toBe('120.00');

    const after = await prisma.order.findFirstOrThrow({ where: { id: before.id } });
    // Commission rose 114 -> 120, so the estimated net profit dropped.
    expect(new Decimal(after.estimatedNetProfit!).lt(new Decimal(before.estimatedNetProfit!))).toBe(
      true,
    );
  });

  it('fresh == buffer: direct-calculable and buffer->promote paths agree on commission + profit', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });

    // Path A -- direct: variant already has cost -> calculable -> upsert (fallback).
    const barcodeA = 'EAN13-COMM-A';
    await seedVariant(org.id, store.id, barcodeA, true);
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'direct-A',
        barcode: barcodeA,
        commissionKnown: false,
        categoryId: CATEGORY_ID,
        commissionRate: '0',
        commissionGross: '0.00',
      }),
    );

    // Path B -- buffer: variant cost-missing -> intake buffers; cost then arrives
    // and the entry is flipped PROMOTING (cost-attach service simulation) -> promote.
    const barcodeB = 'EAN13-COMM-B';
    const variantB = await seedVariant(org.id, store.id, barcodeB, false);
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'buffer-B',
        barcode: barcodeB,
        commissionKnown: false,
        categoryId: CATEGORY_ID,
        commissionRate: '0',
        commissionGross: '0.00',
      }),
    });
    expect(outcome).toEqual({ kind: 'buffered' });

    await attachCost(org.id, variantB);
    await prisma.livePerformanceBuffer.updateMany({
      where: { storeId: store.id, platformOrderId: 'buffer-B' },
      data: { status: 'PROMOTING' },
    });
    await processBufferPromote();

    const itemA = await prisma.orderItem.findFirstOrThrow({
      where: { organizationId: org.id, order: { platformOrderId: 'direct-A' } },
    });
    const itemB = await prisma.orderItem.findFirstOrThrow({
      where: { organizationId: org.id, order: { platformOrderId: 'buffer-B' } },
    });
    // Same category fallback -> identical commission on both paths.
    expect(new Decimal(itemA.commissionGross).toFixed(2)).toBe('114.00');
    expect(new Decimal(itemB.commissionRate).toString()).toBe(
      new Decimal(itemA.commissionRate).toString(),
    );
    expect(new Decimal(itemB.commissionGross).toFixed(2)).toBe(
      new Decimal(itemA.commissionGross).toFixed(2),
    );

    const orderA = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'direct-A' },
    });
    const orderB = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'buffer-B' },
    });
    expect(orderA.estimatedNetProfit).not.toBeNull();
    expect(orderB.estimatedNetProfit).not.toBeNull();
    // Both ingest paths land on the same net profit.
    expect(new Decimal(orderB.estimatedNetProfit!).toFixed(2)).toBe(
      new Decimal(orderA.estimatedNetProfit!).toFixed(2),
    );
  });

  it('stale never wins: an older lastModifiedDate is dropped by the freshness guard', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    await seedVariant(org.id, store.id, BARCODE, true);

    const t0 = new Date('2026-07-08T06:00:00.000Z');
    const t1 = new Date('2026-07-08T09:00:00.000Z');
    const t2 = new Date('2026-07-08T12:00:00.000Z');

    // T0: create with fallback commission 114.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'stale-1',
        commissionKnown: false,
        categoryId: CATEGORY_ID,
        commissionRate: '0',
        commissionGross: '0.00',
        lastModifiedDate: t0,
      }),
    );
    // T2: real commission 20 -> refresh (watermark advances to T2).
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'stale-1',
        commissionKnown: true,
        categoryId: CATEGORY_ID,
        commissionRate: '20',
        commissionGross: '120.00',
        lastModifiedDate: t2,
      }),
    );
    // T1 (< T2): stale re-delivery with commission 5 -> guard returns early.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'stale-1',
        commissionKnown: true,
        categoryId: CATEGORY_ID,
        commissionRate: '5',
        commissionGross: '30.00',
        lastModifiedDate: t1,
      }),
    );

    const item = await prisma.orderItem.findFirstOrThrow({
      where: { organizationId: org.id, order: { storeId: store.id, platformOrderId: 'stale-1' } },
    });
    // Still the fresh T2 commission — the stale event never touched the row.
    expect(new Decimal(item.commissionRate).toString()).toBe('20');
    expect(new Decimal(item.commissionGross).toFixed(2)).toBe('120.00');
  });

  it('settled preserved: a non-null settledCommissionGross blocks the refresh', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    await seedVariant(org.id, store.id, BARCODE, true);

    const t1 = new Date('2026-07-08T08:00:00.000Z');
    const t2 = new Date('2026-07-08T12:00:00.000Z');

    // Create with fallback commission 114.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'settled-1',
        commissionKnown: false,
        categoryId: CATEGORY_ID,
        commissionRate: '0',
        commissionGross: '0.00',
        lastModifiedDate: t1,
      }),
    );
    const order = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'settled-1' },
    });
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { organizationId: org.id, orderId: order.id },
    });
    const estimateBefore = order.estimatedNetProfit;

    // A settlement wrote the real commission into the mutable settled column.
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { settledCommissionGross: '90.00' },
    });

    // A later webhook carries a different commission (20) with a newer lmd.
    await upsertOrderWithSnapshot(
      store.id,
      org.id,
      buildMapped({
        platformOrderId: 'settled-1',
        commissionKnown: true,
        categoryId: CATEGORY_ID,
        commissionRate: '20',
        commissionGross: '120.00',
        lastModifiedDate: t2,
      }),
    );

    const afterItem = await prisma.orderItem.findFirstOrThrow({ where: { id: item.id } });
    // settled is set -> the estimate-side commission columns are NOT refreshed.
    expect(new Decimal(afterItem.commissionRate).toString()).toBe('19');
    expect(new Decimal(afterItem.commissionGross).toFixed(2)).toBe('114.00');
    // The real settled value is untouched by the write path.
    expect(new Decimal(afterItem.settledCommissionGross!).toFixed(2)).toBe('90.00');

    const afterOrder = await prisma.order.findFirstOrThrow({ where: { id: order.id } });
    // Estimate reads item.commissionGross (still 114) -> net profit unchanged.
    expect(new Decimal(afterOrder.estimatedNetProfit!).toFixed(2)).toBe(
      new Decimal(estimateBefore!).toFixed(2),
    );
  });
});
