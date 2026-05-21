// Integration tests for handlePaymentOrderEntry (PR-7 commit 5).
//
// Covers the full confirmation cascade:
//   1. handleSale backfills Order.paymentOrderId from the Sale settlement row
//   2. handlePaymentOrderEntry finds the cycle's orders via paymentOrderId
//   3. ESTIMATE PSF/Stoppage OrderFees get confirmedAt + confirmedBy
//   4. recomputeSettledProfit writes Order.settledNetProfit
//   5. Order.reconciliationStatus → FULLY_SETTLED
//
// PR-9 invariant verified: estimatedNetProfit is NOT touched.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { handlePaymentOrderEntry, handleSale } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const BARCODE = 'EAN13-PMT';
const SHIPMENT_PACKAGE_ID = 555_777_999;
const PAYMENT_ORDER_ID = 88_888_888;

interface BuiltOrder {
  storeId: string;
  organizationId: string;
  orderId: string;
  itemId: string;
  estimatedNetProfit: Decimal;
}

async function buildOrderReadyForCycle(): Promise<BuiltOrder> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: 'PMT Cascade Test',
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

  // Order arrives with ESTIMATE already applied: estimatedNetProfit set
  // by applyEstimateOnOrderCreate at order arrival. PR-9 trigger guards
  // this column — the cascade must not touch it.
  const estimatedNetProfit = new Decimal('45.00');
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      orderDate: new Date(),
      status: 'DELIVERED',
      saleSubtotalNet: new Decimal('100.00'),
      saleVatTotal: new Decimal('20.00'),
      estimatedNetProfit,
      reconciliationStatus: 'NOT_SETTLED',
    },
  });

  const item = await prisma.orderItem.create({
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
      // Cost snapshot present so recomputeSettledProfit can complete.
      unitCostSnapshotNet: new Decimal('40.00'),
      unitCostSnapshotVatRate: new Decimal('20.00'),
      unitCostSnapshotVatAmount: new Decimal('8.00'),
    },
  });

  // Seed an ESTIMATE PSF OrderFee (what applyEstimateOnOrderCreate would write).
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

  return {
    storeId: store.id,
    organizationId: org.id,
    orderId: order.id,
    itemId: item.id,
    estimatedNetProfit,
  };
}

function makeSaleRow(): TrendyolFinancialTransaction {
  return {
    id: 'sale-1',
    transactionDate: 1715000000000,
    barcode: BARCODE,
    transactionType: 'Satış',
    receiptId: 1001,
    description: 'Satış',
    debt: 0,
    credit: 120,
    paymentPeriod: 30,
    commissionRate: 10,
    commissionAmount: 12,
    commissionInvoiceSerialNumber: 'DCF1',
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

function makePaymentOrderRow(): TrendyolFinancialTransaction {
  return {
    id: PAYMENT_ORDER_ID.toString(),
    transactionDate: 1715800000000,
    barcode: null,
    transactionType: 'Ödeme',
    receiptId: null,
    description: 'TRENDYOL Marketplace Ödeme',
    debt: 200,
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

describe('handlePaymentOrderEntry — confirmation cascade', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('handleSale backfills Order.paymentOrderId from Sale settlement row', async () => {
    const built = await buildOrderReadyForCycle();

    await prisma.$transaction(async (tx) => {
      const result = await handleSale(built.storeId, makeSaleRow(), tx);
      expect(result.applied).toBe(true);
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: built.orderId } });
    expect(order.paymentOrderId).toBe(BigInt(PAYMENT_ORDER_ID));
    expect(order.paymentDate?.toISOString()).toBe(new Date(1715800000000).toISOString());
  });

  it('skips with no_orders_in_cycle when Sale has not backfilled yet', async () => {
    const built = await buildOrderReadyForCycle();
    // No handleSale call → Order.paymentOrderId still null.

    await prisma.$transaction(async (tx) => {
      const result = await handlePaymentOrderEntry(
        built.storeId,
        built.organizationId,
        makePaymentOrderRow(),
        tx,
      );
      expect(result).toEqual({ applied: false, skipReason: 'no_orders_in_cycle' });
    });
  });

  it('full cascade: Sale → PaymentOrder → confirmed fees + settledNetProfit + FULLY_SETTLED', async () => {
    const built = await buildOrderReadyForCycle();

    // Run handleSale to backfill Order.paymentOrderId
    await prisma.$transaction(async (tx) => {
      await handleSale(built.storeId, makeSaleRow(), tx);
    });

    // Run PaymentOrder cascade
    await prisma.$transaction(async (tx) => {
      const result = await handlePaymentOrderEntry(
        built.storeId,
        built.organizationId,
        makePaymentOrderRow(),
        tx,
      );
      expect(result.applied).toBe(true);
      expect(result.orderCount).toBe(1);
    });

    // ESTIMATE fees confirmed
    const fees = await prisma.orderFee.findMany({
      where: { orderId: built.orderId },
      orderBy: { feeType: 'asc' },
    });
    expect(fees).toHaveLength(2);
    expect(fees[0]!.source).toBe('ESTIMATE'); // origin stays
    expect(fees[0]!.confirmedAt).not.toBeNull();
    expect(fees[0]!.confirmedBy).toBe(`PaymentOrder:${PAYMENT_ORDER_ID}`);
    expect(fees[1]!.confirmedAt).not.toBeNull();

    // settledNetProfit written, estimatedNetProfit untouched (PR-9 invariant)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: built.orderId } });
    expect(order.settledNetProfit).not.toBeNull();
    expect(order.estimatedNetProfit?.toFixed(2)).toBe(built.estimatedNetProfit.toFixed(2));
    expect(order.reconciliationStatus).toBe('FULLY_SETTLED');

    // Sanity: settledNetProfit = 100 (sale net) − 40 (cost) − 10 (commission)
    //                          − 0 (no seller discount) − (10.99 PSF + 1.00 stoppage)
    //                          = 38.01 net
    expect(order.settledNetProfit!.toFixed(2)).toBe('38.01');
  });

  it('idempotent: second cascade run does not change values', async () => {
    const built = await buildOrderReadyForCycle();
    await prisma.$transaction(async (tx) => {
      await handleSale(built.storeId, makeSaleRow(), tx);
    });
    await prisma.$transaction(async (tx) => {
      await handlePaymentOrderEntry(built.storeId, built.organizationId, makePaymentOrderRow(), tx);
    });

    const before = await prisma.orderFee.findFirst({
      where: { orderId: built.orderId, feeType: 'PLATFORM_SERVICE' },
      select: { confirmedAt: true, confirmedBy: true },
    });

    // Second run — no-op for already-confirmed fees
    await prisma.$transaction(async (tx) => {
      const result = await handlePaymentOrderEntry(
        built.storeId,
        built.organizationId,
        makePaymentOrderRow(),
        tx,
      );
      expect(result.applied).toBe(true);
      expect(result.orderCount).toBe(1);
    });

    const after = await prisma.orderFee.findFirst({
      where: { orderId: built.orderId, feeType: 'PLATFORM_SERVICE' },
      select: { confirmedAt: true, confirmedBy: true },
    });

    // confirmedAt unchanged on the second run — updateMany's null filter skipped.
    expect(after!.confirmedAt?.toISOString()).toBe(before!.confirmedAt?.toISOString());
    expect(after!.confirmedBy).toBe(before!.confirmedBy);
  });

  it('PR-9 invariant: cascade does NOT touch estimatedNetProfit', async () => {
    const built = await buildOrderReadyForCycle();

    await prisma.$transaction(async (tx) => {
      await handleSale(built.storeId, makeSaleRow(), tx);
    });
    await prisma.$transaction(async (tx) => {
      await handlePaymentOrderEntry(built.storeId, built.organizationId, makePaymentOrderRow(), tx);
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: built.orderId } });
    // estimatedNetProfit preserved exactly; the write-once trigger would
    // have rejected any value-distinct UPDATE.
    expect(order.estimatedNetProfit?.toFixed(2)).toBe(built.estimatedNetProfit.toFixed(2));
  });

  it('sparse_field skip when paymentOrderId is null on PaymentOrder row', async () => {
    const built = await buildOrderReadyForCycle();

    await prisma.$transaction(async (tx) => {
      const result = await handlePaymentOrderEntry(
        built.storeId,
        built.organizationId,
        { ...makePaymentOrderRow(), paymentOrderId: null },
        tx,
      );
      expect(result).toEqual({ applied: false, skipReason: 'sparse_field' });
    });
  });
});
