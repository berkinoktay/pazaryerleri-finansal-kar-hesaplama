import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization } from '../../helpers/factories';

/**
 * PR-4 — CostProfile KDV ayrıştırma (design §3.5 düzeltilmiş, §12.1 #10).
 *
 * Convention empirik doğrulandı: `amount` NET. PR-4 sadece `vatAmount`
 * eklemeyi yapar. Backfill formülü: `vat_amount = ROUND(amount × vat_rate / 100, 2)`.
 * Snapshot için ek: `vat_amount_in_try = ROUND(amount_in_try × vat_rate / 100, 2)`.
 *
 * 3 tablo paralel (CostProfile + CostProfileVersion + OrderItemCostSnapshotComponent).
 * Her tabloda CHECK constraint: vat_amount IS NULL OR vat_amount >= 0.
 */
describe('CostProfile vat_amount (PR-4)', () => {
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

  describe('CostProfile.vatAmount', () => {
    it('new row defaults vatAmount to null (nullable column)', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          vatRate: 20,
        },
      });
      expect(profile.vatAmount).toBeNull();
    });

    it('accepts explicit vatAmount value', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          vatRate: 20,
          vatAmount: '20.00',
        },
      });
      expect(new Decimal(profile.vatAmount!).toString()).toBe('20');
    });

    it('CHECK constraint rejects negative vatAmount', async () => {
      const { org } = await setup();
      await expect(
        prisma.costProfile.create({
          data: {
            organizationId: org.id,
            name: 'Test',
            type: 'COGS',
            amount: '100.00',
            vatRate: 20,
            vatAmount: '-1.00',
          },
        }),
      ).rejects.toThrow(/check|violat/i);
    });

    it('CHECK constraint allows zero (boundary)', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          vatRate: 0,
          vatAmount: '0.00',
        },
      });
      expect(new Decimal(profile.vatAmount!).toString()).toBe('0');
    });
  });

  describe('Backfill formula precision (Decimal)', () => {
    // Migration.sql backfill formülü: ROUND(amount × vat_rate / 100, 2)
    // Bu test'ler aynı formülü dev DB'ye uygulayıp Decimal precision'ını doğrular.
    // %0 / %1 / %10 / %18 / %20 — gerçek dünyadaki tüm yaygın oranlar.
    it.each([
      { amount: '100.00', vatRate: 0, expected: '0' },
      { amount: '100.00', vatRate: 1, expected: '1' },
      { amount: '100.00', vatRate: 10, expected: '10' },
      { amount: '100.00', vatRate: 18, expected: '18' },
      { amount: '100.00', vatRate: 20, expected: '20' },
      { amount: '83.33', vatRate: 20, expected: '16.67' }, // round halfup
      { amount: '125.50', vatRate: 18, expected: '22.59' }, // round halfup
      { amount: '7.49', vatRate: 18, expected: '1.35' }, // 1.3482 → 1.35
    ])(
      'amount=$amount vatRate=$vatRate → vatAmount=$expected',
      async ({ amount, vatRate, expected }) => {
        const { org } = await setup();
        const profile = await prisma.costProfile.create({
          data: {
            organizationId: org.id,
            name: `Test ${vatRate}`,
            type: 'COGS',
            amount,
            vatRate,
          },
        });
        // Backfill formülünü çalıştır
        await prisma.$executeRaw`
        UPDATE cost_profiles
           SET vat_amount = ROUND(amount * vat_rate::numeric / 100, 2)
         WHERE id = ${profile.id}::uuid
      `;
        const fresh = await prisma.costProfile.findUniqueOrThrow({ where: { id: profile.id } });
        expect(new Decimal(fresh.vatAmount!).equals(expected)).toBe(true);
      },
    );
  });

  describe('CostProfileVersion.vatAmount', () => {
    it('version row CHECK constraint blocks negative', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          vatRate: 20,
        },
      });
      await expect(
        prisma.costProfileVersion.create({
          data: {
            profileId: profile.id,
            organizationId: org.id,
            version: 1,
            name: 'Test',
            type: 'COGS',
            amount: '100.00',
            currency: 'TRY',
            vatRate: 20,
            vatAmount: '-5.00',
            fxRateMode: 'AUTO',
            changedFields: [],
          },
        }),
      ).rejects.toThrow(/check|violat/i);
    });

    it('version row accepts valid vatAmount', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          vatRate: 20,
        },
      });
      const version = await prisma.costProfileVersion.create({
        data: {
          profileId: profile.id,
          organizationId: org.id,
          version: 1,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          currency: 'TRY',
          vatRate: 20,
          vatAmount: '20.00',
          fxRateMode: 'AUTO',
          changedFields: [],
        },
      });
      expect(new Decimal(version.vatAmount!).toString()).toBe('20');
    });
  });

  describe('OrderItemCostSnapshotComponent.vatAmount + vatAmountInTry', () => {
    // OrderItem yaratmaya gerek yok — sadece CHECK constraint davranışını
    // doğrulamak yeterli; gerçek snapshot capture PR-6'ya bağlı.

    it('snapshot CHECK blocks negative vatAmount', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          vatRate: 20,
        },
      });
      // Snapshot için bir OrderItem gerek — minimal fixture
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
          totalAmount: '100',
          commissionAmount: '20',
          shippingCost: '10',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          quantity: 1,
          unitPrice: '100',
          commissionRate: '20',
          commissionAmount: '20',
        },
      });
      await expect(
        prisma.orderItemCostSnapshotComponent.create({
          data: {
            orderItemId: item.id,
            organizationId: org.id,
            profileId: profile.id,
            profileName: 'Test',
            profileType: 'COGS',
            amount: '100.00',
            currency: 'TRY',
            vatRate: 20,
            amountInTry: '100.00',
            vatAmount: '-2.00', // negatif → CHECK reddi
            fxRateMode: 'AUTO',
            fxRateUsed: '1.00',
            fxRateSource: 'manual',
          },
        }),
      ).rejects.toThrow(/check|violat/i);
    });

    it('snapshot CHECK blocks negative vatAmountInTry', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
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
          totalAmount: '100',
          commissionAmount: '20',
          shippingCost: '10',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          quantity: 1,
          unitPrice: '100',
          commissionRate: '20',
          commissionAmount: '20',
        },
      });
      await expect(
        prisma.orderItemCostSnapshotComponent.create({
          data: {
            orderItemId: item.id,
            organizationId: org.id,
            profileId: profile.id,
            profileName: 'Test',
            profileType: 'COGS',
            amount: '100.00',
            currency: 'USD',
            vatRate: 20,
            amountInTry: '3000.00',
            vatAmount: '20.00',
            vatAmountInTry: '-600.00', // negatif → CHECK reddi
            fxRateMode: 'AUTO',
            fxRateUsed: '30.00',
            fxRateSource: 'tcmb',
          },
        }),
      ).rejects.toThrow(/check|violat/i);
    });

    it('snapshot accepts valid vat_amount + vat_amount_in_try (USD fx scenario)', async () => {
      const { org } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          name: 'Test',
          type: 'COGS',
          amount: '100.00',
          currency: 'USD',
          vatRate: 18,
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
          totalAmount: '100',
          commissionAmount: '20',
          shippingCost: '10',
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          quantity: 1,
          unitPrice: '100',
          commissionRate: '20',
          commissionAmount: '20',
        },
      });
      const snapshot = await prisma.orderItemCostSnapshotComponent.create({
        data: {
          orderItemId: item.id,
          organizationId: org.id,
          profileId: profile.id,
          profileName: 'Test',
          profileType: 'COGS',
          amount: '100.00',
          currency: 'USD',
          vatRate: 18,
          amountInTry: '3000.00', // 100 USD × 30 TRY/USD
          vatAmount: '18.00', // 100 × 18/100
          vatAmountInTry: '540.00', // 3000 × 18/100
          fxRateMode: 'AUTO',
          fxRateUsed: '30.00',
          fxRateSource: 'tcmb',
        },
      });
      expect(new Decimal(snapshot.vatAmount!).toString()).toBe('18');
      expect(new Decimal(snapshot.vatAmountInTry!).toString()).toBe('540');
    });
  });
});
