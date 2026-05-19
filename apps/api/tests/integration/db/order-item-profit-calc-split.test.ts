import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCommissionInvoice,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/**
 * PR-3 — OrderItem zenginleştirme (design §3.2).
 *
 * KDV ayrıştırması + commission split (gross/refunded) + sellerDiscount +
 * cost snapshot KDV + commissionInvoice referansı. Yeni kolonların DB'de
 * doğru yaşadığını, default'ların 0 olduğunu, CHECK constraint'inin
 * çalıştığını, ve CommissionInvoice ↔ OrderItem two-way relation'ı
 * doğrula.
 */
describe('OrderItem profit-calc split (PR-3)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setup() {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);
    return { org, store, order };
  }

  it('new monetary columns default to 0 when not provided', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
      },
    });
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });

    expect(new Decimal(fresh.grossCommissionAmountNet).toString()).toBe('0');
    expect(new Decimal(fresh.grossCommissionVatAmount).toString()).toBe('0');
    expect(new Decimal(fresh.refundedCommissionAmountNet).toString()).toBe('0');
    expect(new Decimal(fresh.refundedCommissionVatAmount).toString()).toBe('0');
    expect(new Decimal(fresh.sellerDiscountNet).toString()).toBe('0');
    expect(new Decimal(fresh.sellerDiscountVatAmount).toString()).toBe('0');
  });

  it('nullable VAT/cost-snapshot split columns default to null', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
      },
    });
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });

    expect(fresh.unitPriceNet).toBeNull();
    expect(fresh.unitVatRate).toBeNull();
    expect(fresh.unitVatAmount).toBeNull();
    expect(fresh.unitCostSnapshotNet).toBeNull();
    expect(fresh.unitCostSnapshotVatRate).toBeNull();
    expect(fresh.unitCostSnapshotVatAmount).toBeNull();
    expect(fresh.commissionInvoiceSerialNumber).toBeNull();
    expect(fresh.commissionInvoiceId).toBeNull();
  });

  it('stores KDV-split values with Decimal precision', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '120.00',
        commissionRate: '20.00',
        commissionAmount: '24.00',
        // KDV ayrıştırma: gross 120 = net 100 + KDV 20 (%20).
        unitPriceNet: '100.00',
        unitVatRate: '20.00',
        unitVatAmount: '20.00',
        // Commission: gross 24 = 20 (net) + 4 (KDV %20).
        grossCommissionAmountNet: '20.00',
        grossCommissionVatAmount: '4.00',
      },
    });
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });

    expect(new Decimal(fresh.unitPriceNet!).toString()).toBe('100');
    expect(new Decimal(fresh.unitVatRate!).toString()).toBe('20');
    expect(new Decimal(fresh.unitVatAmount!).toString()).toBe('20');
    expect(new Decimal(fresh.grossCommissionAmountNet).toString()).toBe('20');
    expect(new Decimal(fresh.grossCommissionVatAmount).toString()).toBe('4');
  });

  it('CHECK constraint blocks refunded > gross commission', async () => {
    const { order } = await setup();
    // refunded > gross → CHECK constraint reddi (23514 check_violation).
    await expect(
      prisma.orderItem.create({
        data: {
          orderId: order.id,
          quantity: 1,
          unitPrice: '100.00',
          commissionRate: '20.00',
          commissionAmount: '20.00',
          grossCommissionAmountNet: '10.00',
          refundedCommissionAmountNet: '15.00', // > gross
        },
      }),
    ).rejects.toThrow(/check|violat|order_items_refunded_commission_check/i);
  });

  it('CHECK constraint allows refunded == gross (boundary)', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
        grossCommissionAmountNet: '20.00',
        refundedCommissionAmountNet: '20.00', // == gross, boundary OK
      },
    });
    expect(item.id).toBeDefined();
  });

  it('CHECK constraint blocks UPDATE that violates invariant', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
        grossCommissionAmountNet: '20.00',
        refundedCommissionAmountNet: '5.00',
      },
    });
    await expect(
      prisma.orderItem.update({
        where: { id: item.id },
        data: { refundedCommissionAmountNet: '25.00' }, // gross 20'den büyük
      }),
    ).rejects.toThrow(/check|violat/i);
  });

  it('commissionInvoice two-way relation: include orderItems works', async () => {
    const { org, store, order } = await setup();
    const invoice = await createCommissionInvoice(org.id, store.id, {
      trendyolSerialNumber: 'DCF2026TEST001',
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
        commissionInvoiceId: invoice.id,
        commissionInvoiceSerialNumber: 'DCF2026TEST001',
      },
    });

    const invoiceWithItems = await prisma.commissionInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { orderItems: true },
    });
    expect(invoiceWithItems.orderItems).toHaveLength(1);
    expect(invoiceWithItems.orderItems[0]?.id).toBe(item.id);

    const itemWithInvoice = await prisma.orderItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { commissionInvoice: true },
    });
    expect(itemWithInvoice.commissionInvoice?.trendyolSerialNumber).toBe('DCF2026TEST001');
  });

  it('deleting CommissionInvoice nulls OrderItem.commissionInvoiceId (SetNull)', async () => {
    const { org, store, order } = await setup();
    const invoice = await createCommissionInvoice(org.id, store.id);
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
        commissionInvoiceId: invoice.id,
      },
    });

    await prisma.commissionInvoice.delete({ where: { id: invoice.id } });

    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.commissionInvoiceId).toBeNull();
  });

  it('commission_invoice_id index exists on order_items', async () => {
    // Index ekledik (@@index([commissionInvoiceId])) — psql metadata kontrolü.
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'order_items'
        AND indexname = 'order_items_commission_invoice_id_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});
