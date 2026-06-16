// Integration tests for handleCommissionInvoice (PR-7 commit 6).
//
// Verifies the two-stage populate (design §3.8):
//   1. Sale settlement row sets OrderItem.commissionInvoiceSerialNumber
//      (handleSale, commit 3 — pre-existing behaviour)
//   2. otherfinancials Komisyon Faturası row creates CommissionInvoice
//      + batch backfills OrderItem.commissionInvoiceId FK (1:N)

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { handleCommissionInvoice } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const SERIAL = 'DCF2026001708462';
const PAYMENT_ORDER_ID = 99_111_222;

interface BuiltCtx {
  storeId: string;
  organizationId: string;
  itemIds: string[];
}

async function buildOrderWithItemsCarryingSerial(itemCount: number): Promise<BuiltCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: `pkg-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'DELIVERED',
    },
  });

  const itemIds: string[] = [];
  for (let i = 0; i < itemCount; i++) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        productMainId: `main-${randomUUID().slice(0, 8)}`,
        title: `Item ${i}`,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        barcode: `B-${randomUUID().slice(0, 12)}`,
        stockCode: `SKU-${randomUUID().slice(0, 8)}`,
        salePrice: new Decimal('120.00'),
        listPrice: new Decimal('120.00'),
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        productVariantId: variant.id,
        quantity: 1,
        // GROSS CONVENTION (2026-06-16): lineListGross/lineSaleGross; commissionGross=12.
        // unitPrice/commissionAmount removed from schema.
        lineListGross: new Decimal('120.00'),
        lineSaleGross: new Decimal('120.00'),
        commissionRate: new Decimal('10.00'),
        commissionGross: new Decimal('12.00'),
        // commit 3 (handleSale) writes this; we pre-fill here to simulate
        // the post-Sale state.
        commissionInvoiceSerialNumber: SERIAL,
        // commissionInvoiceId is the focus — null until this commit's handler fills it.
      },
    });
    itemIds.push(item.id);
  }

  return { storeId: store.id, organizationId: org.id, itemIds };
}

function makeCommissionInvoiceRow(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: SERIAL,
    transactionDate: Date.UTC(2026, 5, 1),
    barcode: null,
    transactionType: 'Komisyon Faturası',
    receiptId: null,
    description: 'Komisyon Faturası',
    debt: 12.0, // KDV-dahil; net = 10.00, vat = 2.00
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: Date.UTC(2026, 5, 1),
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
    ...overrides,
  };
}

describe('handleCommissionInvoice', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    // handleCommissionInvoice komisyon KDV oranını fee_definitions
    // ALL/COMMISSION_INVOICE'tan çözer (denetim A) → seed gerekir.
    await ensureFeeDefinitions();
  });

  it('creates CommissionInvoice + backfills OrderItem.commissionInvoiceId (1:N)', async () => {
    const { storeId, organizationId, itemIds } = await buildOrderWithItemsCarryingSerial(3);

    await prisma.$transaction(async (tx) => {
      const result = await handleCommissionInvoice(
        storeId,
        organizationId,
        makeCommissionInvoiceRow(),
        tx,
      );
      expect(result.applied).toBe(true);
      expect(result.backfilledItemCount).toBe(3);
    });

    const invoice = await prisma.commissionInvoice.findUniqueOrThrow({
      where: { storeId_trendyolSerialNumber: { storeId, trendyolSerialNumber: SERIAL } },
    });
    expect(invoice.organizationId).toBe(organizationId);
    expect(invoice.totalNet.toFixed(2)).toBe('10.00');
    expect(invoice.totalVat.toFixed(2)).toBe('2.00');
    expect(invoice.paymentOrderId).toBe(BigInt(PAYMENT_ORDER_ID));

    // All 3 OrderItems point at the invoice
    const items = await prisma.orderItem.findMany({ where: { id: { in: itemIds } } });
    for (const item of items) {
      expect(item.commissionInvoiceId).toBe(invoice.id);
    }
  });

  it('is idempotent — second run does not duplicate the invoice or re-update items', async () => {
    const { storeId, organizationId, itemIds } = await buildOrderWithItemsCarryingSerial(2);

    await prisma.$transaction(async (tx) => {
      await handleCommissionInvoice(storeId, organizationId, makeCommissionInvoiceRow(), tx);
    });
    await prisma.$transaction(async (tx) => {
      const result = await handleCommissionInvoice(
        storeId,
        organizationId,
        makeCommissionInvoiceRow(),
        tx,
      );
      // Upsert update path runs (metadata may change); items already
      // backfilled so updateMany count is 0.
      expect(result.applied).toBe(true);
      expect(result.backfilledItemCount).toBe(0);
    });

    const invoices = await prisma.commissionInvoice.findMany({
      where: { storeId, trendyolSerialNumber: SERIAL },
    });
    expect(invoices).toHaveLength(1);
    // FK still set on both items, unchanged from first pass.
    const items = await prisma.orderItem.findMany({ where: { id: { in: itemIds } } });
    expect(items.every((i) => i.commissionInvoiceId === invoices[0]!.id)).toBe(true);
  });

  it('handles the orphan case: invoice arrives before any Sale items (no backfill targets)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await prisma.$transaction(async (tx) => {
      const result = await handleCommissionInvoice(
        store.id,
        org.id,
        makeCommissionInvoiceRow(),
        tx,
      );
      expect(result.applied).toBe(true);
      expect(result.backfilledItemCount).toBe(0);
    });

    // Invoice exists — Sale handler can later write serialNumber on items
    // and a future invoice-pass (re-poll) will backfill the FK.
    const invoice = await prisma.commissionInvoice.findUniqueOrThrow({
      where: { storeId_trendyolSerialNumber: { storeId: store.id, trendyolSerialNumber: SERIAL } },
    });
    expect(invoice.totalNet.toFixed(2)).toBe('10.00');
  });

  it('skips with sparse_field when paymentOrderId is null', async () => {
    const { storeId, organizationId } = await buildOrderWithItemsCarryingSerial(1);

    await prisma.$transaction(async (tx) => {
      const result = await handleCommissionInvoice(
        storeId,
        organizationId,
        makeCommissionInvoiceRow({ paymentOrderId: null }),
        tx,
      );
      expect(result).toEqual({ applied: false, skipReason: 'sparse_field' });
    });
  });

  it('tenant scope — items in a different organization are NOT backfilled by another org invoice', async () => {
    const orgA = await buildOrderWithItemsCarryingSerial(2);
    const orgB = await buildOrderWithItemsCarryingSerial(2);
    // Both orgs happen to carry the same Trendyol serial (rare but
    // possible — Trendyol global). Each upsert writes its own row.

    await prisma.$transaction(async (tx) => {
      await handleCommissionInvoice(
        orgA.storeId,
        orgA.organizationId,
        makeCommissionInvoiceRow(),
        tx,
      );
    });

    const itemsA = await prisma.orderItem.findMany({ where: { id: { in: orgA.itemIds } } });
    const itemsB = await prisma.orderItem.findMany({ where: { id: { in: orgB.itemIds } } });
    expect(itemsA.every((i) => i.commissionInvoiceId !== null)).toBe(true);
    expect(itemsB.every((i) => i.commissionInvoiceId === null)).toBe(true);
  });
});
