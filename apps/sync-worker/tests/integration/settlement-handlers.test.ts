// Integration tests for the Sale / Discount / Return settlement handlers
// (PR-7 commit 3). Real DB + Decimal arithmetic + idempotency assertions.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { handleDiscount, handleReturn, handleSale } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const BARCODE = 'EAN13-001';
const SHIPMENT_PACKAGE_ID = 999_123_456;

function makeSettlementRow(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: '725041340',
    transactionDate: 1715000000000,
    barcode: BARCODE,
    transactionType: 'Satış',
    receiptId: 48376618,
    description: 'Satış',
    debt: 0,
    credit: 120,
    paymentPeriod: 30,
    commissionRate: 10,
    commissionAmount: 12, // 10% of 120 → KDV-dahil; net = 10, vat = 2
    commissionInvoiceSerialNumber: 'DCF2026001708462',
    sellerRevenue: 108,
    orderNumber: '11101228439',
    paymentOrderId: null,
    paymentDate: null,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: 1715000000000,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
    ...overrides,
  };
}

async function buildOrderWithItem(): Promise<{
  storeId: string;
  orderId: string;
  itemId: string;
  variantId: string;
}> {
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
      title: 'Test',
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

  // createOrder factory doesn't expose platformOrderId override — inline
  // create so the handler's `(storeId, platformOrderId)` lookup matches.
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      orderDate: new Date(),
      status: 'DELIVERED',
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
      // Pre-fill gross commission so the CHECK constraint
      // (refunded <= gross) tolerates the Discount handler writes
      // in the happy-path test. Mirrors what Order Sync mapper would
      // have written during order arrival.
      grossCommissionAmountNet: new Decimal('10.00'),
      grossCommissionVatAmount: new Decimal('2.00'),
    },
  });

  return { storeId: store.id, orderId: order.id, itemId: item.id, variantId: variant.id };
}

describe('settlement handlers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(async () => {
    // no-op (truncateAll on beforeEach is sufficient)
  });

  // ─── handleSale ──────────────────────────────────────────────────────

  describe('handleSale', () => {
    it('updates OrderItem grossCommission* + commissionInvoiceSerialNumber', async () => {
      const { storeId, itemId } = await buildOrderWithItem();
      const row = makeSettlementRow({ commissionAmount: 12 });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // 12 / 1.20 = 10, 12 − 10 = 2
      expect(updated.grossCommissionAmountNet.toFixed(2)).toBe('10.00');
      expect(updated.grossCommissionVatAmount.toFixed(2)).toBe('2.00');
      expect(updated.commissionInvoiceSerialNumber).toBe('DCF2026001708462');
      // FK stays null — commit 6 (CommissionInvoice synthesis) will backfill.
      expect(updated.commissionInvoiceId).toBeNull();
    });

    it('skips with sparse_field when shipmentPackageId is null', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({ shipmentPackageId: null });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'sparse_field' });
      });
    });

    it('skips with order_not_found when shipmentPackageId has no matching Order', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({ shipmentPackageId: 999999 });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      });
    });

    it('skips with variant_not_found when barcode is unmapped', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({ barcode: 'UNKNOWN-BARCODE' });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'variant_not_found' });
      });
    });
  });

  // ─── handleDiscount ───────────────────────────────────────────────────

  describe('handleDiscount', () => {
    it('updates refundedCommission* + sellerDiscount* using unitVatRate', async () => {
      const { storeId, itemId } = await buildOrderWithItem();
      // Discount mirrors Sale: debt = lineSellerDiscount KDV-dahil (24 @ %20 → net 20, vat 4)
      // commissionAmount = refunded commission KDV-dahil (6 → net 5, vat 1)
      const row = makeSettlementRow({
        transactionType: 'İndirim',
        debt: 24,
        credit: 0,
        commissionAmount: 6,
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleDiscount(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // 6 / 1.20 = 5.00 (commission VAT %20 sabit)
      expect(updated.refundedCommissionAmountNet.toFixed(2)).toBe('5.00');
      expect(updated.refundedCommissionVatAmount.toFixed(2)).toBe('1.00');
      // 24 / 1.20 = 20 (item's unitVatRate %20)
      expect(updated.sellerDiscountNet.toFixed(2)).toBe('20.00');
      expect(updated.sellerDiscountVatAmount.toFixed(2)).toBe('4.00');
    });

    // CHECK constraint `refunded <= gross` is a schema-level invariant
    // covered in apps/api/tests/integration/db/order-item-profit-calc-split.test.ts.
    // Handler scope is the write semantics; constraint enforcement is the DB's.
  });

  // ─── handleReturn ─────────────────────────────────────────────────────

  describe('handleReturn', () => {
    it('inserts OrderFee REFUND_DEDUCTION with KDV split from item unitVatRate', async () => {
      const { storeId, orderId } = await buildOrderWithItem();
      // Return.debt = item gross price (KDV-dahil) → split via unitVatRate %20
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(1);
      expect(fees[0]!.feeType).toBe('REFUND_DEDUCTION');
      expect(fees[0]!.source).toBe('SETTLEMENT');
      expect(fees[0]!.direction).toBe('DEBIT');
      // 120 / 1.20 = 100, 120 - 100 = 20
      expect(fees[0]!.amountNet.toFixed(2)).toBe('100.00');
      expect(fees[0]!.vatAmount.toFixed(2)).toBe('20.00');
      expect(fees[0]!.vatRate.toFixed(2)).toBe('20.00');
      expect(fees[0]!.feeDefinitionId).toBeNull(); // settlement-sourced
      // externalRef carries Trendyol identifiers for audit + idempotency
      expect(fees[0]!.externalRef).toMatchObject({
        trendyolId: row.id,
        sellerId: row.sellerId,
        receiptId: row.receiptId,
      });
    });

    it('is idempotent — re-running on same row does not duplicate the fee', async () => {
      const { storeId, orderId } = await buildOrderWithItem();
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        await handleReturn(storeId, row, tx);
      });
      // Second call — same Trendyol id, should detect existing externalRef.
      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(false);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(1);
    });

    it('skips with order_not_found when Order is missing', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        shipmentPackageId: 888888,
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      });
    });
  });
});
