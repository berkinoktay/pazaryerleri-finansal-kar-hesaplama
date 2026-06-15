import { describe, it, expect } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('OrderItem GROSS convention columns', () => {
  it('has gross + vatRate columns, no net columns', async () => {
    const present = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'order_items' AND column_name IN (
        'line_list_gross', 'line_sale_gross', 'line_seller_discount_gross',
        'sale_vat_rate', 'commission_gross', 'refunded_commission_gross',
        'commission_vat_rate', 'estimated_commission_gross', 'settled_commission_gross',
        'unit_cost_snapshot_gross', 'unit_cost_snapshot_vat_rate'
      ) ORDER BY column_name`;
    expect(present).toHaveLength(11);

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

describe('Order GROSS + marj + promosyon columns', () => {
  it('has gross aggregate + margin + promotion columns', async () => {
    const present = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name IN (
        'sale_gross', 'sale_vat', 'list_gross', 'seller_discount_gross', 'seller_discount_vat',
        'estimated_sale_margin_pct', 'settled_sale_margin_pct',
        'estimated_cost_markup_pct', 'settled_cost_markup_pct', 'promotion_displays'
      )`;
    expect(present).toHaveLength(10);

    const removed = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name IN ('sale_subtotal_net', 'sale_vat_total')`;
    expect(removed).toHaveLength(0);
  });
});
