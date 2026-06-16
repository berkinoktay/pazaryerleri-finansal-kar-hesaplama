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
 *   - order_fees: amount_net, vat_amount
 *
 * Yerine gelen GROSS kolonlar (sanity):
 *   - orders: sale_gross, sale_vat, list_gross, seller_discount_gross
 *   - order_items: line_sale_gross, line_seller_discount_gross,
 *       unit_cost_snapshot_gross, unit_cost_snapshot_vat_rate, commission_gross
 *   - order_fees: amount_gross, vat_rate
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
    ['order_fees', 'amount_net'],
    ['order_fees', 'vat_amount'],
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
    ['order_items', 'unit_cost_snapshot_gross'],
    ['order_items', 'unit_cost_snapshot_vat_rate'],
    ['order_items', 'commission_gross'],
    ['order_fees', 'amount_gross'],
    ['order_fees', 'vat_rate'],
  ])('%s table HAS new gross column %s', async (tableName, columnName) => {
    expect(await columnExists(tableName, columnName)).toBe(true);
  });
});
