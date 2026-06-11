// Integration tests for the Sale / Discount / Return settlement handlers
// (PR-7 commit 3). Real DB + Decimal arithmetic + idempotency assertions.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

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

async function buildOrderWithItem(opts?: { withCostAndSale?: boolean }): Promise<{
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
      platformOrderNumber: '11101228439',
      orderDate: new Date(),
      status: 'DELIVERED',
      // Sale aggregate enables recomputeSettledProfit in the Return trio
      // test (it skips on null aggregates — old fixtures keep that path).
      ...(opts?.withCostAndSale === true
        ? {
            saleSubtotalNet: new Decimal('100.00'),
            saleVatTotal: new Decimal('20.00'),
            // Payment cycle already ran (settled figure exists) — the
            // late-return refresh path is the one under test.
            settledNetProfit: new Decimal('50.00'),
          }
        : {}),
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
      ...(opts?.withCostAndSale === true
        ? {
            unitCostSnapshotNet: new Decimal('40.00'),
            unitCostSnapshotVatRate: new Decimal('20.00'),
            unitCostSnapshotVatAmount: new Decimal('8.00'),
          }
        : {}),
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
    vi.restoreAllMocks();
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

    // PR-C orphan invariant: a Discount row whose order was hard-skipped
    // (PR-B calculability gate) finds no local Order. It must silent-skip —
    // never throw — and emit a structured worker log (never surfaced to the
    // seller). Symmetric with the handleSale + handleReturn order_not_found
    // cases above.
    it('skips with order_not_found + structured warn when Order is missing', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({
        transactionType: 'İndirim',
        debt: 24,
        credit: 0,
        commissionAmount: 6,
        shipmentPackageId: 999999,
      });
      const warnSpy = vi.spyOn(syncLog, 'warn');

      const result = await prisma.$transaction((tx) => handleDiscount(storeId, row, tx));

      expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      expect(warnSpy).toHaveBeenCalledWith(
        'settlements.discount.order-not-found',
        expect.objectContaining({ platformOrderId: '999999' }),
      );
    });

    // CHECK constraint `refunded <= gross` is a schema-level invariant
    // covered in apps/api/tests/integration/db/order-item-profit-calc-split.test.ts.
    // Handler scope is the write semantics; constraint enforcement is the DB's.
  });

  // ─── handleReturn ─────────────────────────────────────────────────────

  describe('handleReturn', () => {
    it('writes the full trio (REFUND_DEDUCTION + COMMISSION_REFUND + COST_RETURN) and recomputes settled profit to exactly 0 on a full single-unit return', async () => {
      // Issue #291 money-trail proof: Trendyol nets the commission inside
      // the Return row, and the returned unit's cost never materialized.
      // Numbers: sale net 100 + VAT 20; commission gross 12 (net 10 + 2);
      // cost snapshot net 40 + VAT 8. A FULL return must therefore zero
      // the order: 100 − 40(cost) − 10(comm) − 100(refund) + 10(comm
      // refund) + 40(cost return) = 0.00.
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({
        where: { orderId },
        orderBy: { feeType: 'asc' },
      });
      expect(fees.map((f) => f.feeType).sort()).toEqual([
        'COMMISSION_REFUND',
        'COST_RETURN',
        'REFUND_DEDUCTION',
      ]);
      // #297: every leg stamps the identity column — without it the
      // settlement partial unique never applies and dedupe silently breaks.
      expect(fees.map((f) => f.trendyolTransactionId)).toEqual([row.id, row.id, row.id]);

      const refund = fees.find((f) => f.feeType === 'REFUND_DEDUCTION')!;
      expect(refund.direction).toBe('DEBIT');
      // 120 / 1.20 = 100, 120 - 100 = 20 (item unitVatRate split)
      expect(refund.amountNet.toFixed(2)).toBe('100.00');
      expect(refund.vatAmount.toFixed(2)).toBe('20.00');
      expect(refund.vatRate.toFixed(2)).toBe('20.00');
      expect(refund.feeDefinitionId).toBeNull();
      expect(refund.externalRef).toMatchObject({
        trendyolId: row.id,
        sellerId: row.sellerId,
        receiptId: row.receiptId,
      });

      const commission = fees.find((f) => f.feeType === 'COMMISSION_REFUND')!;
      expect(commission.direction).toBe('CREDIT');
      // commissionAmount 12 KDV-dahil → fixed 20% commission-VAT split
      expect(commission.amountNet.toFixed(2)).toBe('10.00');
      expect(commission.vatAmount.toFixed(2)).toBe('2.00');
      expect(commission.externalRef).toMatchObject({ trendyolId: row.id });

      const costReturn = fees.find((f) => f.feeType === 'COST_RETURN')!;
      expect(costReturn.direction).toBe('CREDIT');
      // one UNIT's cost snapshot handed back
      expect(costReturn.amountNet.toFixed(2)).toBe('40.00');
      expect(costReturn.vatAmount.toFixed(2)).toBe('8.00');
      expect(costReturn.vatRate.toFixed(2)).toBe('20.00');

      // Orphan-fee fix: the handler refreshed the ALREADY-SETTLED figure
      // itself (fixture pre-sets 50.00 as the payment cycle's output) —
      // no PaymentOrder re-poll needed. Full return → exactly zero.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit?.toFixed(2)).toBe('0.00');
    });

    it('skips the commission credit (loudly) when the row carries no commissionAmount', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
        commissionAmount: null,
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees.map((f) => f.feeType).sort()).toEqual(['COST_RETURN', 'REFUND_DEDUCTION']);
    });

    it('skips the cost reversal (loudly) when the item has no cost snapshot yet', async () => {
      const { storeId, orderId } = await buildOrderWithItem(); // snapshot'sız fixture
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees.map((f) => f.feeType).sort()).toEqual(['COMMISSION_REFUND', 'REFUND_DEDUCTION']);
      // No sale aggregate on this fixture → recompute skipped, no write.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit).toBeNull();
    });

    it('is idempotent — re-running on same row duplicates none of the trio', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
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
      expect(fees).toHaveLength(3);
    });

    it('matches via the OrderClaim bridge when shipmentPackageId is the RETURN parcel id (live finding 6/6)', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      // Claims sync stamped the return-parcel id on the claim — since #298
      // in the indexed orderShipmentPackageId column. externalRef is a
      // DECOY on purpose: audit-only, and if the bridge ever regressed to
      // the old JSONB path filter it would match nothing → applied=false.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await prisma.orderClaim.create({
        data: {
          organizationId: order.organizationId,
          storeId,
          orderId,
          trendyolClaimId: randomUUID(),
          claimDate: new Date(),
          resolved: false,
          orderShipmentPackageId: '999111222',
          externalRef: { orderShipmentPackageId: 'stale-audit-decoy' },
        },
      });

      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
        shipmentPackageId: 999_111_222, // return parcel — NOT the outbound package
        orderNumber: null, // force the bridge path, no fallback available
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(3);
    });

    it('falls back to orderNumber + barcode single-candidate when no claim bridge exists', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
        shipmentPackageId: 777_555_333, // unknown return parcel, no claim synced yet
        // orderNumber default '11101228439' == fixture's platformOrderNumber
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(3);
    });

    it('SELF-HEAL: a cost snapshot entered after the first poll backfills COST_RETURN on re-poll', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem(); // snapshot'sız
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const r1 = await handleReturn(storeId, row, tx);
        expect(r1.applied).toBe(true);
      });
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(2); // COST_RETURN eksik

      // Berkin maliyeti sonradan girer (Maliyet Bekleyen akışı).
      await prisma.orderItem.update({
        where: { id: itemId },
        data: {
          unitCostSnapshotNet: new Decimal('40.00'),
          unitCostSnapshotVatRate: new Decimal('20.00'),
          unitCostSnapshotVatAmount: new Decimal('8.00'),
        },
      });

      // 6h re-poll: aynı satır — eksik bacak tamamlanır.
      await prisma.$transaction(async (tx) => {
        const r2 = await handleReturn(storeId, row, tx);
        expect(r2.applied).toBe(true);
      });
      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees.map((f) => f.feeType).sort()).toEqual([
        'COMMISSION_REFUND',
        'COST_RETURN',
        'REFUND_DEDUCTION',
      ]);
    });

    it('EARLY RETURN: skips the settled-profit refresh when the payment cycle has not run yet', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem();
      // Cost + sale aggregate present, but NO settled figure (cycle pending).
      await prisma.order.update({
        where: { id: orderId },
        data: { saleSubtotalNet: new Decimal('100.00'), saleVatTotal: new Decimal('20.00') },
      });
      await prisma.orderItem.update({
        where: { id: itemId },
        data: {
          unitCostSnapshotNet: new Decimal('40.00'),
          unitCostSnapshotVatRate: new Decimal('20.00'),
          unitCostSnapshotVatAmount: new Decimal('8.00'),
        },
      });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      // Fees landed, but no premature settled figure — the upcoming
      // payment cycle will compute it with confirmed ESTIMATE fees.
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(3);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit).toBeNull();
    });

    it('skips with order_not_found when nothing matches (unknown parcel + unknown orderNumber)', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        shipmentPackageId: 888888,
        orderNumber: 'NO-SUCH-ORDER',
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      });
    });
  });
});
