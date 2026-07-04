import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — advantage_tariffs (+ items)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // Two-tenant fixture: only userA authenticates (scoped client); orgB is a
  // valid OWNER'd tenant whose private Advantage tariff data userA must not see.
  async function twoTenantsSetup() {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([
      createStore(orgA.id, { name: 'A Store' }),
      createStore(orgB.id, { name: 'B Store' }),
    ]);
    return { userA, client, orgA, orgB, storeA, storeB };
  }

  // Seeded via Prisma (postgres role bypasses RLS) — a tariff → item chain,
  // both carrying the tenant's store_id.
  async function seedAdvantageTariffChain(organizationId: string, storeId: string) {
    const tariff = await prisma.advantageTariff.create({
      data: {
        organizationId,
        storeId,
        name: 'Avantajlı Ürün Etiketleri',
      },
    });
    const item = await prisma.advantageTariffItem.create({
      data: {
        organizationId,
        storeId,
        tariffId: tariff.id,
        barcode: 'TB100X150A',
        productTitle: '100x150 Cm Kumaş Türk Bayrağı',
        currentPrice: '360.00',
        customerPrice: '360.00',
        hasCommissionTariff: true,
        starTiers: [
          { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
          { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
          { key: 'tier3', upperLimit: '223.78', lowerLimit: null },
        ],
        applyUntilEnd: false,
        sortOrder: 0,
      },
    });
    return { tariff, item };
  }

  it('org A user CANNOT read org B Advantage tariff chain', async () => {
    const { client, orgB, storeB } = await twoTenantsSetup();
    await seedAdvantageTariffChain(orgB.id, storeB.id);

    const tariffs = await client.from('advantage_tariffs').select('id');
    const items = await client.from('advantage_tariff_items').select('id');

    expect(tariffs.error).toBeNull();
    expect(tariffs.data?.map((r) => r.id)).toEqual([]);
    expect(items.data?.map((r) => r.id)).toEqual([]);
  });

  it('org A user CAN read own org A Advantage tariff chain', async () => {
    const { client, orgA, storeA } = await twoTenantsSetup();
    const { tariff, item } = await seedAdvantageTariffChain(orgA.id, storeA.id);

    const tariffs = await client.from('advantage_tariffs').select('id,name');
    const items = await client.from('advantage_tariff_items').select('id,barcode');

    expect(tariffs.error).toBeNull();
    expect(tariffs.data?.map((r) => r.id)).toEqual([tariff.id]);
    expect(items.data?.map((r) => r.id)).toEqual([item.id]);
  });
});
