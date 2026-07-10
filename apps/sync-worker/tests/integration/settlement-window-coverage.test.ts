// Settlement scan window regression guard (PR-7 stage validation BUG #5 + #6,
// plus the store.createdAt clamp — owner decision 2026-07-10).
//
// Three-layer contract pinned here:
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
// 3. (createdAt clamp) The overall scan start is max(now - 60d, store.createdAt).
//    A store connected less than 60 days ago has no transactions dated before
//    it existed, so slices that fall entirely before store.createdAt are never
//    requested and a partially overlapping slice starts at store.createdAt.
//
// Assertions:
//   - Store older than 60d: 4 slices, every window ≤ 15 days, union ≈ 60 days,
//     and a T-35d Sale row (falls inside the 3rd chunk) reaches handleSale
//     and backfills Order.paymentOrderId.
//   - Fresh store (createdAt = yesterday): exactly ONE slice, starting at
//     store.createdAt.

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
  storeCreatedAt: Date;
  organizationId: string;
  orderId: string;
  syncLogId: string;
}

async function buildScenario(storeCreatedAt: Date): Promise<BuiltCtx> {
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
      // The scan-start clamp reads store.createdAt, so the fixture controls it
      // explicitly instead of leaning on the DB default (= now).
      createdAt: storeCreatedAt,
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
      // GROSS CONVENTION (2026-06-16, Bölüm E Task 20): saleGross/saleVat.
      saleGross: new Decimal('120.00'),
      saleVat: new Decimal('20.00'),
      reconciliationStatus: 'NOT_SETTLED',
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: variant.id,
      quantity: 1,
      // GROSS CONVENTION (2026-06-16): lineListGross/lineSaleGross; commissionGross replaces
      // grossCommissionAmountNet (12.00 gross). saleVatRate replaces unitVatRate.
      lineListGross: new Decimal('120.00'),
      lineSaleGross: new Decimal('120.00'),
      saleVatRate: new Decimal('20.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('12.00'),
    },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'SETTLEMENTS',
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: 'worker-test',
      lastTickAt: new Date(),
      progressCurrent: 0,
    },
  });

  return {
    storeId: store.id,
    storeCreatedAt: store.createdAt,
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

// Distinct chunk windows captured across all fetchSettlements calls. Each
// chunk fires one call per SETTLEMENT_TYPE (3), all sharing the same window,
// so the distinct-window count IS the slice count.
function distinctWindows(windows: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  const byKey = new Map<string, { start: Date; end: Date }>();
  for (const win of windows) {
    byKey.set(`${win.start.getTime()}-${win.end.getTime()}`, win);
  }
  return [...byKey.values()];
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

  it('store older than 60d: chunks the 60-day scan into 4 ≤15-day slices and backfills a T-35d Sale row', async () => {
    const now = Date.now();
    // Store connected 90 days ago → clamp is inert (max(now-60d, now-90d) = now-60d).
    const { storeId, syncLogId, orderId } = await buildScenario(new Date(now - 90 * MS_PER_DAY));
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
    await processSettlementsChunk({ syncLog, cursor: null, workerId: 'worker-test' }, mockFetchers);

    // 0. Slice count: an older-than-60d store is unaffected by the clamp →
    //    the full 4 sliding chunks are requested.
    const slices = distinctWindows(capturedWindows);
    expect(slices.length).toBe(4);

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

  it('fresh store (createdAt = yesterday): requests exactly one slice, starting at store.createdAt', async () => {
    const now = Date.now();
    // Integer-ms createdAt → the DB roundtrip is exact, so the clamped start
    // can be asserted for equality.
    const createdAt = new Date(now - MS_PER_DAY);
    const { syncLogId, storeCreatedAt } = await buildScenario(createdAt);

    const capturedWindows: { start: Date; end: Date }[] = [];
    const mockFetchers = {
      fetchSettlements: async function* (
        opts: FetchSettlementsOpts,
      ): AsyncGenerator<TrendyolFinancialTransaction, void> {
        capturedWindows.push({ start: opts.startDate, end: opts.endDate });
        // Record the window only; this scenario yields no rows.
        yield* [];
      },
      fetchOtherFinancials: async function* (
        _opts: FetchOtherFinancialsOpts,
      ): AsyncGenerator<TrendyolFinancialTransaction, void> {
        // empty
      },
      fetchCargoInvoiceItems: async () => [],
    };

    const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
    await processSettlementsChunk({ syncLog, cursor: null, workerId: 'worker-test' }, mockFetchers);

    // Exactly one slice: chunks older than store.createdAt (a store one day
    // old means chunks 2..4 fall entirely before it) are never requested.
    const slices = distinctWindows(capturedWindows);
    expect(slices.length).toBe(1);

    const only = slices[0];
    if (only === undefined) throw new Error('unreachable — one slice asserted above');

    // The single slice starts exactly at store.createdAt (clamped), not at
    // now - 60d.
    expect(only.start.getTime()).toBe(storeCreatedAt.getTime());
    // ...and spans only ~1 day, well within the 15-day per-call cap.
    const days = (only.end.getTime() - only.start.getTime()) / MS_PER_DAY;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(15.1);
  });
});
