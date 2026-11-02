import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';

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
    const store = await createStore(org.id);
    return { org, store };
  }

  describe('CostProfile.amountGross + vatRate', () => {
    it('stores amountGross (KDV-dahil) and vatRate as given', async () => {
      const { org, store } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
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
      const { org, store } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
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
        const { org, store } = await setup();
        const profile = await prisma.costProfile.create({
          data: {
            organizationId: org.id,
            storeId: store.id,
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
      const { org, store } = await setup();
      const profile = await prisma.costProfile.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
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
          vatRate: profile.vatRate,
          changedFields: [],
        },
      });
      expect(version.amountGross?.toFixed(2)).toBe('120.00');
      expect(Number(version.vatRate)).toBe(20);
    });
  });
});
