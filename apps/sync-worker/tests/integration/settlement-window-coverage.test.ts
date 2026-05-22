// Settlement scan window regression guard (PR-7 stage validation BUG #5).
//
// Trendyol payment cycle T+45 worst-case (10 delivery + 28 payment term +
// 7 Wednesday wait) — a 15-day window misses the entire paymentOrderId
// stamping phase. Empirical stage observation 2026-05-22: 97/500 Sale
// rows stamped in T-30..T-15 segment; 0/500 in T-15..T-0. Fix bumps
// SCAN_WINDOW_DAYS 15 → 60. This test pins the contract: a Sale row
// dated T-35d (inside the stamping phase but outside the legacy 15d
// window) must be picked up by the cron, and Order.paymentOrderId must
// backfill so PaymentOrder cascade can resolve later in the cycle.
//
// Assertions:
//   1. fetcher receives startDate ≈ now − 60d (window range contract)
//   2. T-35d Sale row reaches handleSale → Order.paymentOrderId backfill

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import type {
  FetchOtherFinancialsOpts,
  FetchSettlementsOpts,
  TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';

import { processSettlementsChunk } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BARCODE = 'EAN13-WINDOW';
const SHIPMENT_PACKAGE_ID = 555_666_777;
const PAYMENT_ORDER_ID = 88_888_222;

interface BuiltCtx {
  storeId: string;
  organizationId: string;
  orderId: string;
  syncLogId: string;
}

async function buildScenario(): Promise<BuiltCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const credentials = encryptCredentials({
    supplierId: '123456',
    apiKey: 'k',
    apiSecret: 's',
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Window Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '123456',
      credentials,
      status: 'ACTIVE',
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: 'Window Test Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: BARCODE,
      stockCode: `SKU-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('120.00'),
      listPrice: new Decimal('120.00'),
    },
  });

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      orderDate: new Date(),
      status: 'DELIVERED',
      saleSubtotalNet: new Decimal('100.00'),
      saleVatTotal: new Decimal('20.00'),
      reconciliationStatus: 'NOT_SETTLED',
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: variant.id,
      quantity: 1,
      unitPrice: new Decimal('120.00'),
      commissionRate: new Decimal('10.00'),
      commissionAmount: new Decimal('12.00'),
      unitPriceNet: new Decimal('100.00'),
      unitVatRate: new Decimal('20.00'),
      unitVatAmount: new Decimal('20.00'),
      grossCommissionAmountNet: new Decimal('10.00'),
      grossCommissionVatAmount: new Decimal('2.00'),
    },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'SETTLEMENTS',
      status: 'RUNNING',
      startedAt: new Date(),
      progressCurrent: 0,
    },
  });

  return {
    storeId: store.id,
    organizationId: org.id,
    orderId: order.id,
    syncLogId: syncLog.id,
  };
}

function makeOldSaleRow(
  transactionDateMs: number,
  paymentDateMs: number,
): TrendyolFinancialTransaction {
  return {
    id: 'sale-window-1',
    transactionDate: transactionDateMs,
    barcode: BARCODE,
    transactionType: 'Satış',
    receiptId: 7002,
    description: 'Satış',
    debt: 0,
    credit: 120,
    paymentPeriod: 28,
    commissionRate: 10,
    commissionAmount: 12,
    commissionInvoiceSerialNumber: 'DCF-WINDOW-2026-01',
    sellerRevenue: 108,
    orderNumber: '11101228440',
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: paymentDateMs,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: transactionDateMs,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
  };
}

describe('processSettlementsChunk — scan window coverage', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('opens a 60-day window and picks up T-35d Sale rows', async () => {
    const { storeId, syncLogId, orderId } = await buildScenario();
    const now = Date.now();
    const t35d = now - 35 * MS_PER_DAY;
    const saleRow = makeOldSaleRow(t35d, t35d + 10 * MS_PER_DAY);

    const capturedWindows: { start: Date; end: Date }[] = [];

    const mockFetchers = {
      fetchSettlements: async function* (
        opts: FetchSettlementsOpts,
      ): AsyncGenerator<TrendyolFinancialTransaction, void> {
        capturedWindows.push({ start: opts.startDate, end: opts.endDate });
        if (opts.transactionType === 'Sale') yield saleRow;
      },
      fetchOtherFinancials: async function* (
        _opts: FetchOtherFinancialsOpts,
      ): AsyncGenerator<TrendyolFinancialTransaction, void> {
        // empty — window check is on the settlements path
      },
    };

    const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
    await processSettlementsChunk({ syncLog, cursor: null }, mockFetchers);

    // 1. Window contract: every fetcher invocation receives a startDate
    //    ~60 days before endDate. Tolerance: ±0.1d for execution drift.
    expect(capturedWindows.length).toBeGreaterThan(0);
    capturedWindows.forEach((win, i) => {
      const days = (win.end.getTime() - win.start.getTime()) / MS_PER_DAY;
      expect(days, `window span on call ${i}`).toBeGreaterThan(59.9);
      expect(days, `window span on call ${i}`).toBeLessThan(60.1);
    });

    // 2. T-35d row reached handleSale and backfilled Order.paymentOrderId.
    //    With a 15d window this assertion would fail (row out of range,
    //    fetcher never yielded it through the dispatcher).
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.paymentOrderId).toEqual(BigInt(PAYMENT_ORDER_ID));
    expect(updated.paymentDate).not.toBeNull();

    // Sanity: scenario actually wired up the store we built (no silent
    // cross-store leak through a stale fixture).
    expect(syncLog.storeId).toBe(storeId);
  });
});
