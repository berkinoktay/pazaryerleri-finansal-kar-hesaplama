// Settlement cron mega-test (PR-7 commit 8).
//
// Full cycle simulation — verifies the reconciliationStatus state machine
// from NOT_SETTLED → PARTIALLY_SETTLED → FULLY_SETTLED across two ticks,
// then re-asserts idempotency on a third tick.
//
// Dependency-injects mock fetchers so the test owns what Trendyol "returns"
// without hitting the network. The cron + dispatcher + per-handler chain
// is exercised end-to-end.

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

const BARCODE = 'EAN13-CRON';
const SHIPMENT_PACKAGE_ID = 444_555_666;
const PAYMENT_ORDER_ID = 99_999_111;
const PSF_SERIAL = 'DDF-PSF-2026-01';
const COMMISSION_SERIAL = 'DCF-CRON-2026-01';

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

  // Inline store with encrypted credentials (decryptStoreCredentials path).
  const credentials = encryptCredentials({
    supplierId: '123456',
    apiKey: 'k',
    apiSecret: 's',
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Cron Test Store',
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
      title: 'Cron Test Product',
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

  // Order arrives via order sync (ESTIMATE state — applyEstimateOnOrderCreate
  // already ran). Status NOT_SETTLED.
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      orderDate: new Date(),
      status: 'DELIVERED',
      saleSubtotalNet: new Decimal('100.00'),
      saleVatTotal: new Decimal('20.00'),
      estimatedNetProfit: new Decimal('45.00'),
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
      unitCostSnapshotNet: new Decimal('40.00'),
      unitCostSnapshotVatRate: new Decimal('20.00'),
      unitCostSnapshotVatAmount: new Decimal('8.00'),
    },
  });

  // Seed ESTIMATE PSF + Stoppage OrderFees (applyEstimateOnOrderCreate parity)
  await prisma.orderFee.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      feeType: 'PLATFORM_SERVICE',
      source: 'ESTIMATE',
      direction: 'DEBIT',
      amountNet: new Decimal('10.99'),
      vatRate: new Decimal('20.00'),
      vatAmount: new Decimal('2.20'),
    },
  });
  await prisma.orderFee.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      feeType: 'STOPPAGE',
      source: 'ESTIMATE',
      direction: 'DEBIT',
      amountNet: new Decimal('1.00'),
      vatRate: new Decimal('0'),
      vatAmount: new Decimal('0'),
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

// ─── Mock fetcher row builders ───────────────────────────────────────────

function makeSaleRow(): TrendyolFinancialTransaction {
  return {
    id: 'sale-cron-1',
    transactionDate: 1715000000000,
    barcode: BARCODE,
    transactionType: 'Satış',
    receiptId: 7001,
    description: 'Satış',
    debt: 0,
    credit: 120,
    paymentPeriod: 30,
    commissionRate: 10,
    commissionAmount: 12,
    commissionInvoiceSerialNumber: COMMISSION_SERIAL,
    sellerRevenue: 108,
    orderNumber: '11101228439',
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: 1715800000000,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: 1715000000000,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
  };
}

function makeStoppageRow(): TrendyolFinancialTransaction {
  return {
    id: 'stoppage-cron-1',
    transactionDate: 1715800000000,
    barcode: null,
    transactionType: 'E-ticaret Stopajı',
    receiptId: null,
    description: 'Stopaj',
    debt: 1.0,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: 1715800000000,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
  };
}

function makePsfRow(): TrendyolFinancialTransaction {
  return {
    id: PSF_SERIAL,
    transactionDate: 1715800000000,
    barcode: null,
    transactionType: 'Platform Hizmet Bedeli',
    receiptId: null,
    description: 'PSF',
    debt: 13.19,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: PSF_SERIAL,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: 1715800000000,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
  };
}

function makePaymentOrderRow(): TrendyolFinancialTransaction {
  return {
    id: PAYMENT_ORDER_ID.toString(),
    transactionDate: 1715800000000,
    barcode: null,
    transactionType: 'Ödeme',
    receiptId: null,
    description: 'Ödeme',
    debt: 100,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: 1715800000000,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
  };
}

// ─── Mock fetcher factory ────────────────────────────────────────────────

function makeMockFetchers(scenario: {
  settlements: Partial<Record<'Sale' | 'Discount' | 'Return', TrendyolFinancialTransaction[]>>;
  otherFinancials: Partial<
    Record<'PaymentOrder' | 'Stoppage' | 'DeductionInvoices', TrendyolFinancialTransaction[]>
  >;
}) {
  return {
    fetchSettlements: async function* (
      opts: FetchSettlementsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, void> {
      const rows = scenario.settlements[opts.transactionType as 'Sale' | 'Discount' | 'Return'];
      if (!rows) return;
      for (const r of rows) yield r;
    },
    fetchOtherFinancials: async function* (
      opts: FetchOtherFinancialsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, void> {
      const rows =
        scenario.otherFinancials[
          opts.transactionType as 'PaymentOrder' | 'Stoppage' | 'DeductionInvoices'
        ];
      if (!rows) return;
      for (const r of rows) yield r;
    },
  };
}

// ─── Mega-test ───────────────────────────────────────────────────────────

describe('processSettlementsChunk — state machine mega-test', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('NOT_SETTLED → PARTIALLY_SETTLED → FULLY_SETTLED across 2 ticks; idempotent on tick 3', async () => {
    const { storeId, orderId, syncLogId } = await buildScenario();

    // ─── Tick 1: Sale + Stoppage only — partial settlement ─────────────
    // No PaymentOrder yet (T+1..5 phase). Settlement OrderFees land
    // (Stoppage), Sale stamps paymentOrderId on Order, status bumps to
    // PARTIALLY_SETTLED.
    const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
    const result1 = await processSettlementsChunk(
      { syncLog, cursor: null },
      makeMockFetchers({
        settlements: { Sale: [makeSaleRow()] },
        otherFinancials: { Stoppage: [makeStoppageRow()] },
      }),
    );
    expect(result1.kind).toBe('done');

    const orderAfter1 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter1.reconciliationStatus).toBe('PARTIALLY_SETTLED');
    expect(orderAfter1.paymentOrderId).toBe(BigInt(PAYMENT_ORDER_ID));
    expect(orderAfter1.settledNetProfit).toBeNull(); // no PaymentOrder cycle yet

    // ─── Tick 2: PSF + PaymentOrder — full settlement ──────────────────
    const result2 = await processSettlementsChunk(
      { syncLog, cursor: null },
      makeMockFetchers({
        settlements: {}, // Sale row already processed; re-poll absorbs no-op
        otherFinancials: {
          DeductionInvoices: [makePsfRow()],
          PaymentOrder: [makePaymentOrderRow()],
        },
      }),
    );
    expect(result2.kind).toBe('done');

    const orderAfter2 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter2.reconciliationStatus).toBe('FULLY_SETTLED');
    expect(orderAfter2.settledNetProfit).not.toBeNull();
    // PR-9 invariant: estimatedNetProfit untouched
    expect(orderAfter2.estimatedNetProfit?.toFixed(2)).toBe('45.00');

    // ESTIMATE PSF + Stoppage confirmed
    const fees = await prisma.orderFee.findMany({
      where: { orderId, source: 'ESTIMATE' },
    });
    expect(fees.every((f) => f.confirmedAt !== null)).toBe(true);

    // PSF audit row in OrgPeriodFee
    const psfAudit = await prisma.orgPeriodFee.findFirst({
      where: { storeId, feeType: 'PLATFORM_SERVICE' },
    });
    expect(psfAudit?.amountNet.toFixed(2)).toBe('10.99');

    // ─── Tick 3: Idempotent re-poll — same rows, no state change ───────
    const settledNetBefore = orderAfter2.settledNetProfit?.toFixed(2);
    const result3 = await processSettlementsChunk(
      { syncLog, cursor: null },
      makeMockFetchers({
        settlements: { Sale: [makeSaleRow()] },
        otherFinancials: {
          Stoppage: [makeStoppageRow()],
          DeductionInvoices: [makePsfRow()],
          PaymentOrder: [makePaymentOrderRow()],
        },
      }),
    );
    expect(result3.kind).toBe('done');

    const orderAfter3 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter3.reconciliationStatus).toBe('FULLY_SETTLED'); // unchanged
    expect(orderAfter3.settledNetProfit?.toFixed(2)).toBe(settledNetBefore); // unchanged
    expect(orderAfter3.estimatedNetProfit?.toFixed(2)).toBe('45.00'); // PR-9 invariant holds

    // No duplicate OrgPeriodFee rows
    const psfAudits = await prisma.orgPeriodFee.findMany({
      where: { storeId, feeType: 'PLATFORM_SERVICE' },
    });
    expect(psfAudits).toHaveLength(1);

    const stoppageAudits = await prisma.orgPeriodFee.findMany({
      where: { storeId, feeType: 'STOPPAGE' },
    });
    expect(stoppageAudits).toHaveLength(1);
  });

  it('empty cycle — no rows, status unchanged', async () => {
    const { orderId, syncLogId } = await buildScenario();
    const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });

    const result = await processSettlementsChunk(
      { syncLog, cursor: null },
      makeMockFetchers({ settlements: {}, otherFinancials: {} }),
    );
    expect(result.kind).toBe('done');
    expect(result.kind === 'done' && result.finalCount).toBe(0);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.reconciliationStatus).toBe('NOT_SETTLED');
  });
});
