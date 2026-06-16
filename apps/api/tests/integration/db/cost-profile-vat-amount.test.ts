import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization } from '../../helpers/factories';

/**
 * GROSS convention (2026-06-16): `amountGross` (KDV-dahil) + `vatRate` (%).
 *
 * This file replaces the old `vat-amount.test.ts` which tested a `vatAmount`
 * denormalized column that no longer exists. Under GROSS convention the VAT
 * amount is NOT stored — it can be derived from `amountGross` and `vatRate`
 * when needed, but is never persisted as a separate column.
 *
 * These tests verify:
 *   1. `amountGross` and `vatRate` are persisted correctly on CostProfile.
 *   2. `CostProfileVersion` mirrors the same gross fields.
 *   3. `OrderItemCostSnapshotComponent` stores `amountGross` + `amountInTryGross`.
 */
describe('CostProfile gross convention storage (amountGross + vatRate)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setup() {
    const org = await createOrganization();
    return { org };
  }

  describe('CostProfile.amountGross + vatRate', () => {
    it('stores amountGross (KDV-dahil) and vatRate as given', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amountGross: '120.00', // KDV-dahil: 100 net + 20 KDV @ %20
          vatRate: 20,
        },
      });
      expect(profile.amountGross.toFixed(2)).toBe('120.00');
      expect(Number(profile.vatRate)).toBe(20);
    });

    it('accepts vatRate 0 (exempt supplier)', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Zero VAT',
          type: 'COGS',
          amountGross: '50.00',
          vatRate: 0,
        },
      });
      expect(Number(profile.vatRate)).toBe(0);
      expect(profile.amountGross.toFixed(2)).toBe('50.00');
    });

    it.each([
      { amountGross: '100.00', vatRate: 0 },
      { amountGross: '100.00', vatRate: 10 },
      { amountGross: '120.00', vatRate: 20 },
      { amountGross: '118.00', vatRate: 18 },
      { amountGross: '83.33', vatRate: 20 },
      { amountGross: '125.50', vatRate: 18 },
    ])(
      'amountGross=$amountGross vatRate=$vatRate round-trips correctly',
      async ({ amountGross, vatRate }) => {
        const { org } = await setup();
        const profile = await prisma.costProfile.create({
          data: {
            organizationId: org.id,
            name: `Test ${vatRate}`,
            type: 'COGS',
            amountGross,
            vatRate,
          },
        });
        const fresh = await prisma.costProfile.findUniqueOrThrow({ where: { id: profile.id } });
        expect(fresh.amountGross.toFixed(2)).toBe(new Decimal(amountGross).toFixed(2));
        expect(Number(fresh.vatRate)).toBe(vatRate);
      },
    );
  });

  describe('CostProfileVersion.amountGross + vatRate', () => {
    it('version row stores gross fields matching the parent profile', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amountGross: '120.00',
          vatRate: 20,
        },
      });
      const version = await prisma.costProfileVersion.create({
        data: {
          profileId: profile.id,
          organizationId: org.id,
          version: 1,
          name: profile.name,
          type: profile.type,
          amountGross: profile.amountGross,
          currency: profile.currency,
          vatRate: profile.vatRate,
          fxRateMode: profile.fxRateMode,
          changedFields: [],
        },
      });
      expect(version.amountGross?.toFixed(2)).toBe('120.00');
      expect(Number(version.vatRate)).toBe(20);
    });
  });

  describe('OrderItemCostSnapshotComponent.amountGross + amountInTryGross', () => {
    it('snapshot component stores gross fields (TRY-native, fx=1)', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amountGross: '120.00',
          currency: 'TRY',
          vatRate: 20,
        },
      });
      const store = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Test Store',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: `acc-${profile.id.slice(0, 8)}`,
          credentials: 'test-encrypted-blob',
        },
      });
      const order = await prisma.order.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformOrderId: `order-${profile.id.slice(0, 8)}`,
          orderDate: new Date(),
          status: 'DELIVERED',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          quantity: 1,
          lineSaleGross: '120.00',
          commissionGross: '20.00',
        },
      });
      const snapshot = await prisma.orderItemCostSnapshotComponent.create({
        data: {
          orderItemId: item.id,
          organizationId: org.id,
          profileId: profile.id,
          profileName: 'Test',
          profileType: 'COGS',
          amountGross: new Decimal('120.00'),
          currency: 'TRY',
          vatRate: 20,
          amountInTryGross: new Decimal('120.00'), // fx=1 for TRY
          fxRateMode: 'AUTO',
          fxRateUsed: new Decimal('1.00'),
          fxRateSource: 'TRY-NATIVE',
        },
      });
      expect(snapshot.amountGross.toFixed(2)).toBe('120.00');
      expect(snapshot.amountInTryGross.toFixed(2)).toBe('120.00');
      expect(Number(snapshot.vatRate)).toBe(20);
    });

    it('snapshot component stores gross fields for USD AUTO (fx applied)', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'USD COGS',
          type: 'COGS',
          amountGross: new Decimal('10.00'),
          currency: 'USD',
          vatRate: 18,
        },
      });
      const store = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Test Store USD',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: `acc-${profile.id.slice(0, 8)}`,
          credentials: 'test-encrypted-blob',
        },
      });
      const order = await prisma.order.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformOrderId: `order-usd-${profile.id.slice(0, 8)}`,
          orderDate: new Date(),
          status: 'DELIVERED',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          organizationId: org.id,
          quantity: 1,
          lineSaleGross: '500.00',
          commissionGross: '50.00',
        },
      });
      // 10 USD × 45.19 = 451.90 TRY gross
      const snapshot = await prisma.orderItemCostSnapshotComponent.create({
        data: {
          orderItemId: item.id,
          organizationId: org.id,
          profileId: profile.id,
          profileName: 'USD COGS',
          profileType: 'COGS',
          amountGross: new Decimal('10.00'),
          currency: 'USD',
          vatRate: 18,
          amountInTryGross: new Decimal('451.90'),
          fxRateMode: 'AUTO',
          fxRateUsed: new Decimal('45.19'),
          fxRateSource: 'TCMB-2026-05-08',
        },
      });
      expect(snapshot.amountGross.toFixed(2)).toBe('10.00');
      expect(snapshot.amountInTryGross.toFixed(2)).toBe('451.90');
      expect(snapshot.fxRateUsed.toFixed(2)).toBe('45.19');
    });
  });
});
