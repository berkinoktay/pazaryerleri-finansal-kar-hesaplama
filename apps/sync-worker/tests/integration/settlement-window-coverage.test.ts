// Settlement scan window regression guard (PR-7 stage validation BUG #5 + #6).
//
// Two-layer contract pinned here:
//
// 1. (BUG #5) Trendyol payment cycle T+45 worst-case (10 delivery + 28
//    payment term + 7 Wednesday wait) — a 15-day overall scan misses
//    the entire paymentOrderId stamping phase. Empirical stage 2026-05-22:
//    97/500 Sale rows stamped in T-30..T-15; 0/500 in T-15..T-0. Total
//    scan window = 60d.
//
// 2. (BUG #6) Trendyol /financial/settlements + /otherfinancials enforce
//    a 15-day per-call window (FINANCIAL_WINDOW_MAX_DAYS). The 60-day
//    scan therefore slices into 4 sliding 15-day chunks; each fetcher
//    call's window must respect the per-call cap, and the union of the
//    chunk windows must cover the full 60d scan.
//
// Assertions:
//   - Every fetcher call window ≤ 15 days (vendor per-call cap)
//   - Union of windows ≈ 60 days (BUG #5 coverage)
//   - A T-35d Sale row (falls inside the 3rd chunk) reaches handleSale
//     and backfills Order.paymentOrderId

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
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

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
    // Settlement handler'ları komisyon KDV oranını fee_definitions'tan çözer (denetim A).
    await ensureFeeDefinitions();
  });

  it('chunks the 60-day scan into ≤15-day slices and backfills a T-35d Sale row', async () => {
    const { storeId, syncLogId, orderId } = await buildScenario();
    const now = Date.now();
    const t35d = now - 35 * MS_PER_DAY;
    const saleRow = makeOldSaleRow(t35d, t35d + 10 * MS_PER_DAY);

    const capturedWindows: { start: Date; end: Date }[] = [];

    // Mock fetcher mirrors Trendyol's date filter: a row is only yielded
    // when its transactionDate falls inside the requested chunk window.
    // This means the T-35d row reaches the dispatcher exactly once —
    // via the chunk that covers T-45..T-30.
    const mockFetchers = {
      fetchSettlements: async function* (
        opts: FetchSettlementsOpts,
      ): AsyncGenerator<TrendyolFinancialTransaction, void> {
        capturedWindows.push({ start: opts.startDate, end: opts.endDate });
        if (
          opts.transactionType === 'Sale' &&
          saleRow.transactionDate >= opts.startDate.getTime() &&
          saleRow.transactionDate <= opts.endDate.getTime()
        ) {
          yield saleRow;
        }
      },
      fetchOtherFinancials: async function* (
        _opts: FetchOtherFinancialsOpts,
      ): AsyncGenerator<TrendyolFinancialTransaction, void> {
        // empty — window check is on the settlements path
      },
      // PR-8: cargo invoices out of scope for the window-coverage check.
      fetchCargoInvoiceItems: async () => [],
    };

    const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
    await processSettlementsChunk({ syncLog, cursor: null }, mockFetchers);

    // 1. Per-call window cap (BUG #6): every chunk respects the vendor
    //    15-day limit. 0.1d tolerance for execution drift.
    expect(capturedWindows.length).toBeGreaterThan(0);
    capturedWindows.forEach((win, i) => {
      const days = (win.end.getTime() - win.start.getTime()) / MS_PER_DAY;
      expect(days, `span on call ${i}`).toBeGreaterThan(0);
      expect(days, `span on call ${i}`).toBeLessThan(15.1);
    });

    // 2. Total coverage (BUG #5): the union of chunks spans the full
    //    60-day scan window. earliestStart ≈ T-60d, latestEnd ≈ T-0.
    const earliestStart = Math.min(...capturedWindows.map((w) => w.start.getTime()));
    const latestEnd = Math.max(...capturedWindows.map((w) => w.end.getTime()));
    const totalDays = (latestEnd - earliestStart) / MS_PER_DAY;
    expect(totalDays, 'total scan coverage').toBeGreaterThan(59.9);
    expect(totalDays, 'total scan coverage').toBeLessThan(60.1);

    // 3. T-35d row reached handleSale via the chunk that covers it →
    //    Order.paymentOrderId backfilled. Pre-chunking this would only
    //    fire if the entire 60d window was sent in one call (which the
    //    client rejects), so this is the integration kill-shot.
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.paymentOrderId).toEqual(BigInt(PAYMENT_ORDER_ID));
    expect(updated.paymentDate).not.toBeNull();

    // Sanity: scenario actually wired up the store we built (no silent
    // cross-store leak through a stale fixture).
    expect(syncLog.storeId).toBe(storeId);
  });
});
