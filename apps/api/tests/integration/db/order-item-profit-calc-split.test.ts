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
 * OrderItem profit-calc kolonları — GROSS konvansiyon (2026-06-16).
 *
 * Gross satış/komisyon/maliyet kolonları + commission split (gross/refunded) +
 * sellerDiscount (gross) + commissionInvoice referansı. Yeni kolonların DB'de
 * doğru yaşadığını, default'ların 0 olduğunu, CHECK constraint'inin
 * (refunded_commission_gross <= commission_gross) çalıştığını, ve
 * CommissionInvoice ↔ OrderItem two-way relation'ı doğrula.
 */
describe('OrderItem profit-calc split (GROSS)', () => {
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
        commissionRate: '20.00',
      },
    });
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });

    // GROSS konvansiyon: gross satış/komisyon/indirim kolonları default(0).
    expect(new Decimal(fresh.lineListGross).toString()).toBe('0');
    expect(new Decimal(fresh.lineSaleGross).toString()).toBe('0');
    expect(new Decimal(fresh.lineSellerDiscountGross).toString()).toBe('0');
    expect(new Decimal(fresh.saleVatRate).toString()).toBe('0');
    expect(new Decimal(fresh.commissionGross).toString()).toBe('0');
    expect(new Decimal(fresh.refundedCommissionGross).toString()).toBe('0');
    // commissionVatRate default %20 (denetim A #331).
    expect(new Decimal(fresh.commissionVatRate).toString()).toBe('20');
  });

  it('nullable cost-snapshot + commission columns default to null', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        commissionRate: '20.00',
      },
    });
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });

    expect(fresh.unitCostSnapshotGross).toBeNull();
    expect(fresh.unitCostSnapshotVatRate).toBeNull();
    expect(fresh.estimatedCommissionGross).toBeNull();
    expect(fresh.settledCommissionGross).toBeNull();
    expect(fresh.commissionInvoiceSerialNumber).toBeNull();
    expect(fresh.commissionInvoiceId).toBeNull();
  });

  it('stores GROSS values with Decimal precision', async () => {
    const { order } = await setup();
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        quantity: 1,
        // GROSS: lineSaleGross 120 (KDV-dahil satış), saleVatRate %20.
        lineSaleGross: '120.00',
        saleVatRate: '20.00',
        // Commission: gross 24 (net 20 + KDV 4 @%20).
        commissionRate: '20.00',
        commissionGross: '24.00',
        commissionVatRate: '20.00',
        // Cost snapshot gross 60 (net 50 + KDV 10 @%20).
        unitCostSnapshotGross: '60.00',
        unitCostSnapshotVatRate: '20.00',
      },
    });
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });

    expect(new Decimal(fresh.lineSaleGross).toString()).toBe('120');
    expect(new Decimal(fresh.saleVatRate).toString()).toBe('20');
    expect(new Decimal(fresh.commissionGross).toString()).toBe('24');
    expect(new Decimal(fresh.commissionVatRate).toString()).toBe('20');
    expect(new Decimal(fresh.unitCostSnapshotGross!).toString()).toBe('60');
    expect(new Decimal(fresh.unitCostSnapshotVatRate!).toString()).toBe('20');
  });

  it('CHECK constraint blocks refunded > gross commission', async () => {
    const { order } = await setup();
    // refunded_commission_gross > commission_gross → CHECK reddi (23514 check_violation).
    await expect(
      prisma.orderItem.create({
        data: {
          orderId: order.id,
          quantity: 1,
          commissionRate: '20.00',
          commissionGross: '10.00',
          refundedCommissionGross: '15.00', // > gross
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
        commissionRate: '20.00',
        commissionGross: '20.00',
        refundedCommissionGross: '20.00', // == gross, boundary OK
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
        commissionRate: '20.00',
        commissionGross: '20.00',
        refundedCommissionGross: '5.00',
      },
    });
    await expect(
      prisma.orderItem.update({
        where: { id: item.id },
        data: { refundedCommissionGross: '25.00' }, // gross 20'den büyük
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
        commissionRate: '20.00',
        commissionGross: '20.00',
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
        commissionRate: '20.00',
        commissionGross: '20.00',
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
