import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrder, createOrganization, createStore } from '../../helpers/factories';

/**
 * PR-5a — Order state/derived kolonları (design §3.1).
 *
 * 9 yeni kolon: saleSubtotalNet, saleVatTotal, estimatedNetProfit,
 * settledNetProfit, reconciliationStatus, paymentOrderId, paymentDate,
 * deliveredOnTime, platformOrderNumber. + 3 yeni index.
 *
 * Saf additive — backfill PR-5b'de. Default reconciliationStatus = NOT_SETTLED
 * (durum makinesi başlangıcı).
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
    it('reconciliationStatus defaults to NOT_SETTLED', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      expect(order.reconciliationStatus).toBe('NOT_SETTLED');
    });

    it('all nullable kar/state kolonları null defaults', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      expect(order.saleSubtotalNet).toBeNull();
      expect(order.saleVatTotal).toBeNull();
      expect(order.estimatedNetProfit).toBeNull();
      expect(order.settledNetProfit).toBeNull();
      expect(order.paymentOrderId).toBeNull();
      expect(order.paymentDate).toBeNull();
      expect(order.deliveredOnTime).toBeNull();
      expect(order.platformOrderNumber).toBeNull();
    });
  });

  describe('Reconciliation state machine (design §6.1)', () => {
    it('accepts all 3 enum transitions: NOT_SETTLED → PARTIALLY_SETTLED → FULLY_SETTLED', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);

      const partial = await prisma.order.update({
        where: { id: order.id },
        data: { reconciliationStatus: 'PARTIALLY_SETTLED' },
      });
      expect(partial.reconciliationStatus).toBe('PARTIALLY_SETTLED');

      const full = await prisma.order.update({
        where: { id: order.id },
        data: { reconciliationStatus: 'FULLY_SETTLED' },
      });
      expect(full.reconciliationStatus).toBe('FULLY_SETTLED');
    });

    it('rejects invalid enum value', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);

      await expect(
        prisma.order.update({
          where: { id: order.id },
          // @ts-expect-error invalid enum value
          data: { reconciliationStatus: 'INVALID' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('paymentOrderId BigInt round-trip', () => {
    it('stores and reads large Trendyol PaymentOrder IDs (BigInt)', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      const cycle = BigInt('725041340'); // gerçek Trendyol PaymentOrder.id örneği

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { paymentOrderId: cycle, paymentDate: new Date('2026-05-15T12:00:00Z') },
      });

      expect(updated.paymentOrderId).toBe(cycle);
      expect(updated.paymentDate?.toISOString()).toBe('2026-05-15T12:00:00.000Z');
    });
  });

  describe('Sale/profit Decimal precision', () => {
    it('saleSubtotalNet + saleVatTotal store with 2 decimal precision', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { saleSubtotalNet: '83.33', saleVatTotal: '16.67' },
      });
      expect(new Decimal(updated.saleSubtotalNet!).toString()).toBe('83.33');
      expect(new Decimal(updated.saleVatTotal!).toString()).toBe('16.67');
    });

    it('estimatedNetProfit + settledNetProfit store independently', async () => {
      const { org, store } = await setup();
      const order = await createOrder(org.id, store.id);
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { estimatedNetProfit: '12.50', settledNetProfit: '10.80' },
      });
      expect(new Decimal(updated.estimatedNetProfit!).toString()).toBe('12.5');
      expect(new Decimal(updated.settledNetProfit!).toString()).toBe('10.8');
    });
  });

  describe('Indexes (3 new)', () => {
    it.each([
      'orders_organization_id_reconciliation_status_idx',
      'orders_platform_order_number_idx',
      'orders_store_id_payment_order_id_idx',
    ])('%s exists', async (indexName) => {
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
          totalAmount: '100',
          commissionAmount: '20',
          shippingCost: '10',
        },
      });
      expect(order.platformOrderId).toBe('7260001151141191');
      expect(order.platformOrderNumber).toBe('TY-ORDER-12345');
    });
  });
});
