import { prisma } from '@pazarsync/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureDbReachable } from '../../helpers/db';

/**
 * GROSS konvansiyon refactoru (2026-06-16) — eski NET kar kolonlarının silindiği
 * doğrulanır. Motor NET → GROSS (KDV-dahil) geçti; sipariş/satır/ücret artık
 * brüt değer + KDV oranı tutar, net API katmanında türetilir.
 *
 * Silinen NET kolonlar:
 *   - orders: sale_subtotal_net, sale_vat_total
 *   - order_items: unit_price, unit_price_net, unit_vat_rate, unit_vat_amount,
 *       commission_amount, gross_commission_amount_net,
 *       refunded_commission_amount_net, seller_discount_net,
 *       unit_cost_snapshot_net, unit_cost_snapshot_vat_amount
 *
 * Yerine gelen GROSS kolonlar (sanity):
 *   - orders: sale_gross, sale_vat, list_gross, seller_discount_gross
 *   - order_items: line_sale_gross, line_seller_discount_gross
 *
 * Profit engine rebuild (migration 20261111104912): the legacy fee, settlement
 * and commission-invoice tables, the denormalized profit/commission/cost-snapshot
 * columns on orders and order_items, the cost-snapshot write-once trigger and
 * the enums only those tables used are gone. Every profit figure lives in
 * profit_lines / order_profit_statements.
 */

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `;
  return rows.length > 0;
}

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `;
  return rows.length > 0;
}

describe('GROSS refactor — legacy net columns dropped (2026-06-16)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it.each([
    ['orders', 'sale_subtotal_net'],
    ['orders', 'sale_vat_total'],
    ['order_items', 'unit_price'],
    ['order_items', 'unit_price_net'],
    ['order_items', 'unit_vat_rate'],
    ['order_items', 'unit_vat_amount'],
    ['order_items', 'commission_amount'],
    ['order_items', 'gross_commission_amount_net'],
    ['order_items', 'refunded_commission_amount_net'],
    ['order_items', 'seller_discount_net'],
    ['order_items', 'unit_cost_snapshot_net'],
    ['order_items', 'unit_cost_snapshot_vat_amount'],
  ])('%s table has NO legacy net column %s', async (tableName, columnName) => {
    expect(await columnExists(tableName, columnName)).toBe(false);
  });

  it.each([
    ['orders', 'sale_gross'],
    ['orders', 'sale_vat'],
    ['orders', 'list_gross'],
    ['orders', 'seller_discount_gross'],
    ['order_items', 'line_sale_gross'],
    ['order_items', 'line_seller_discount_gross'],
  ])('%s table HAS new gross column %s', async (tableName, columnName) => {
    expect(await columnExists(tableName, columnName)).toBe(true);
  });
});

describe('Profit engine rebuild — legacy profit storage dropped (2026-11-11)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it.each([
    'order_fees',
    'settlements',
    'settlement_items',
    'commission_invoices',
    'org_period_fees',
  ])('table %s is gone', async (tableName) => {
    expect(await tableExists(tableName)).toBe(false);
  });

  it.each([
    ['order_items', 'commission_rate'],
    ['order_items', 'commission_gross'],
    ['order_items', 'refunded_commission_gross'],
    ['order_items', 'commission_vat_rate'],
    ['order_items', 'estimated_commission_gross'],
    ['order_items', 'settled_commission_gross'],
    ['order_items', 'settled_sale_amount'],
    ['order_items', 'commission_invoice_serial_number'],
    ['order_items', 'commission_invoice_id'],
    ['order_items', 'unit_cost_snapshot_gross'],
    ['order_items', 'unit_cost_snapshot_vat_rate'],
    ['order_items', 'snapshot_captured_at'],
    ['orders', 'estimated_sale_margin_pct'],
    ['orders', 'settled_sale_margin_pct'],
    ['orders', 'estimated_cost_markup_pct'],
    ['orders', 'settled_cost_markup_pct'],
    ['orders', 'estimated_net_profit'],
    ['orders', 'settled_net_profit'],
    ['orders', 'estimated_net_vat'],
    ['orders', 'settled_net_vat'],
    ['orders', 'reconciliation_status'],
    ['orders', 'payment_order_id'],
    ['orders', 'payment_date'],
  ])('%s table has NO legacy profit column %s', async (tableName, columnName) => {
    expect(await columnExists(tableName, columnName)).toBe(false);
  });

  it.each([
    ['order_items', 'order_commission_rate_pct'],
    ['orders', 'snapshot_include_stopaj'],
    ['orders', 'snapshot_include_negative_net_vat'],
    ['orders', 'profit_excluded_at'],
    ['orders', 'profit_exclusion_reason'],
  ])('%s table keeps the column %s the engine still reads', async (tableName, columnName) => {
    expect(await columnExists(tableName, columnName)).toBe(true);
  });

  it('the cost-snapshot write-once trigger is gone', async () => {
    const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE tgname = 'order_items_snapshot_immutable'
    `;
    expect(rows).toHaveLength(0);
  });

  it.each(['OrderFeeDirection', 'OrderFeeSource', 'SettlementStatus', 'SettlementItemType'])(
    'enum type %s is gone',
    async (typeName) => {
      const rows = await prisma.$queryRaw<Array<{ typname: string }>>`
        SELECT typname FROM pg_type WHERE typname = ${typeName}
      `;
      expect(rows).toHaveLength(0);
    },
  );
});
