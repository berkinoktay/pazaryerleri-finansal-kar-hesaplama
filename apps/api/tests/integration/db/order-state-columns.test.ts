import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrder, createOrganization, createStore } from '../../helpers/factories';

/**
 * PR-5a — Order state/derived kolonları (design §3.1).
 *
 * The profit, reconciliation and payment-order columns this PR added were
 * dropped by the profit engine rebuild (migration 20261111104912; profit lives
 * in profit_lines / order_profit_statements). What remains here: the gross sale
 * aggregate, deliveredOnTime and platformOrderNumber with its index.
 */
describe('Order state columns (PR-5a)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setup() {
    const org = await createOrganization();
    const store = await createStore(org.id);
    return { org, store };
  }

  describe('Default values for new rows', () => {
    it('nullable state columns default to null', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      expect(order.saleGross).toBeNull();
      expect(order.saleVat).toBeNull();
      expect(order.deliveredOnTime).toBeNull();
      expect(order.platformOrderNumber).toBeNull();
    });
  });

  describe('Sale Decimal precision', () => {
    it('saleGross + saleVat store with 2 decimal precision', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { saleGross: '83.33', saleVat: '16.67' },
      });
      expect(new Decimal(updated.saleGross!).toString()).toBe('83.33');
      expect(new Decimal(updated.saleVat!).toString()).toBe('16.67');
    });
  });

  describe('Indexes', () => {
    it.each(['orders_platform_order_number_idx'])('%s exists', async (indexName) => {
      const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'orders'
          AND indexname = ${indexName}
      `;
      expect(rows).toHaveLength(1);
    });
  });

  describe('platformOrderNumber semantic (design §12.1 #4)', () => {
    it('stores Trendyol orderNumber distinct from platformOrderId (shipmentPackageId)', async () => {
      // platformOrderId = shipmentPackageId (paket-level)
      // platformOrderNumber = orderNumber (üst sipariş; split shipment'ta N pakete referans)
      const { org, store } = await setup();
      const order = await prisma.order.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformOrderId: '7260001151141191', // shipmentPackageId
          platformOrderNumber: 'TY-ORDER-12345', // orderNumber
          orderDate: new Date(),
          status: 'DELIVERED',
        },
      });
      expect(order.platformOrderId).toBe('7260001151141191');
      expect(order.platformOrderNumber).toBe('TY-ORDER-12345');
    });
  });
});
