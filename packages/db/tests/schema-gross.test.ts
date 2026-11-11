import { randomUUID } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Creates the minimal org+store+order structure required to INSERT an OrderItem. */
async function seedOrderForItemTest(db: PrismaClient): Promise<{ orderId: string; orgId: string }> {
  const orgId = randomUUID();
  await db.organization.create({
    data: { id: orgId, name: 'Gross Test Org', slug: `gross-test-${orgId.slice(0, 8)}` },
  });

  const store = await db.store.create({
    data: {
      organizationId: orgId,
      name: 'Gross Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      credentials: 'test-blob',
    },
  });

  const order = await db.order.create({
    data: {
      organizationId: orgId,
      storeId: store.id,
      platformOrderId: `gross-test-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'DELIVERED',
    },
  });

  return { orderId: order.id, orgId };
}

describe('OrderItem GROSS convention columns', () => {
  it('has the gross sale + vatRate columns, no net columns', async () => {
    const present = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'order_items' AND column_name IN (
        'line_list_gross', 'line_sale_gross', 'line_seller_discount_gross',
        'sale_vat_rate', 'order_commission_rate_pct'
      ) ORDER BY column_name`;
    expect(present).toHaveLength(5);

    const removed = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'order_items' AND column_name IN (
        'unit_price_net', 'unit_vat_amount', 'unit_vat_rate',
        'seller_discount_net', 'seller_discount_vat_amount',
        'unit_cost_snapshot_net', 'unit_cost_snapshot_vat_amount'
      )`;
    expect(removed).toHaveLength(0);
  });
});

describe('Order GROSS + promotion columns', () => {
  it('has the gross aggregate + promotion columns', async () => {
    const present = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name IN (
        'sale_gross', 'sale_vat', 'list_gross', 'seller_discount_gross', 'seller_discount_vat',
        'promotion_displays'
      )`;
    expect(present).toHaveLength(6);

    const removed = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name IN ('sale_subtotal_net', 'sale_vat_total')`;
    expect(removed).toHaveLength(0);
  });
});

describe('Maliyet tables GROSS convention', () => {
  it('cost tables have amountGross + vatRate', async () => {
    for (const table of ['cost_profiles', 'cost_profile_versions']) {
      const cols = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = ${table} AND column_name IN ('amount_gross', 'vat_rate')`;
      expect(cols).toHaveLength(2);
    }
  });
});

// The cost-snapshot write-once trigger referenced columns dropped in migration
// 20261111104912. Had it survived, every UPDATE on order_items would fail at
// runtime, so its absence and a plain item update are both pinned here.
describe('OrderItem cost-snapshot trigger removed', () => {
  it('has neither the trigger nor its function', async () => {
    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgname = 'order_items_snapshot_immutable'`;
    expect(triggers).toHaveLength(0);

    const functions = await prisma.$queryRaw<{ proname: string }[]>`
      SELECT proname FROM pg_proc WHERE proname = 'reject_snapshot_update'`;
    expect(functions).toHaveLength(0);
  });

  it('defaults the line money columns to 0 and accepts an item update', async () => {
    const { orderId, orgId } = await seedOrderForItemTest(prisma);

    const item = await prisma.orderItem.create({
      data: {
        orderId,
        organizationId: orgId,
        quantity: 1,
        barcode: 'GROSS-TEST-001',
        platformLineId: BigInt(1),
      },
    });

    expect(new Decimal(item.lineListGross).toString()).toBe('0');
    expect(new Decimal(item.lineSaleGross).toString()).toBe('0');
    expect(new Decimal(item.lineSellerDiscountGross).toString()).toBe('0');
    expect(new Decimal(item.saleVatRate).toString()).toBe('0');
    expect(item.orderCommissionRatePct).toBeNull();

    const updated = await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        quantity: 2,
        lineSaleGross: new Decimal('120.00'),
        saleVatRate: new Decimal('20'),
        orderCommissionRatePct: new Decimal('19.50'),
      },
    });

    expect(updated.quantity).toBe(2);
    expect(new Decimal(updated.lineSaleGross).toString()).toBe('120');
    expect(new Decimal(updated.saleVatRate).toString()).toBe('20');
    expect(new Decimal(updated.orderCommissionRatePct ?? '0').toString()).toBe('19.5');
  });
});
