import { prisma } from '@pazarsync/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureDbReachable } from '../../helpers/db';

/**
 * PR-5c — Eski Order ücret kolonları silindiği doğrulanır (design §9 PR-5c).
 *
 * 6 kolon silindi: total_amount, commission_amount, shipping_cost, platform_fee,
 * vat_amount, net_profit. Yeni convention için saleSubtotalNet + saleVatTotal
 * (PR-5a), OrderFee tablosu (PR-1), OrderItem.grossCommission* (PR-3),
 * estimatedNetProfit + settledNetProfit (PR-5a).
 *
 * PR-5b iptal edildi — production Order verisi yok, sync dormant; bu silme
 * veri kaybı yapmaz.
 */
describe('Order legacy columns dropped (PR-5c)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it.each([
    'total_amount',
    'commission_amount',
    'shipping_cost',
    'platform_fee',
    'vat_amount',
    'net_profit',
  ])('orders table has NO %s column', async (columnName) => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = ${columnName}
    `;
    expect(rows).toHaveLength(0);
  });

  it('orders table still has new PR-5a kar/state kolonları', async () => {
    const expectedNewCols = [
      'sale_subtotal_net',
      'sale_vat_total',
      'estimated_net_profit',
      'settled_net_profit',
      'reconciliation_status',
      'payment_order_id',
      'payment_date',
      'delivered_on_time',
      'platform_order_number',
    ];
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
    `;
    const existing = new Set(rows.map((r) => r.column_name));
    for (const col of expectedNewCols) {
      expect(existing.has(col), `column ${col} should exist`).toBe(true);
    }
  });
});
