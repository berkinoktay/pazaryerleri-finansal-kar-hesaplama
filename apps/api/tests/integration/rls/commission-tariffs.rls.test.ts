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

describe('RLS — commission_tariffs (+ periods, items)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // Two-tenant fixture: only userA authenticates (scoped client); orgB is a
  // valid OWNER'd tenant whose private tariff data userA must not see.
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

  // Seeded via Prisma (postgres role bypasses RLS) — a full tariff → period →
  // item chain, all carrying the tenant's store_id.
  async function seedTariffChain(organizationId: string, storeId: string) {
    const tariff = await prisma.commissionTariff.create({
      data: { organizationId, storeId, name: '23–30 Haziran' },
    });
    const period = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId,
        storeId,
        tariffId: tariff.id,
        dateRangeLabel: '23 Haz 08.00 – 26 Haz 07.59',
        sortOrder: 0,
      },
    });
    const item = await prisma.commissionTariffItem.create({
      data: {
        organizationId,
        storeId,
        periodId: period.id,
        barcode: '8690000000201',
        productTitle: '200x300 cm Kumaş Türk Bayrağı',
        currentPrice: '779.90',
        currentCommissionPct: '0.1900',
        bands: [{ key: 'band1', threshold: '777.10', commissionPct: '0.19' }],
      },
    });
    return { tariff, period, item };
  }

  it('org A user CANNOT read org B commission tariff chain', async () => {
    const { client, orgB, storeB } = await twoTenantsSetup();
    await seedTariffChain(orgB.id, storeB.id);

    const tariffs = await client.from('commission_tariffs').select('id');
    const periods = await client.from('commission_tariff_periods').select('id');
    const items = await client.from('commission_tariff_items').select('id');

    expect(tariffs.error).toBeNull();
    expect(tariffs.data?.map((r) => r.id)).toEqual([]);
    expect(periods.data?.map((r) => r.id)).toEqual([]);
    expect(items.data?.map((r) => r.id)).toEqual([]);
  });

  it('org A user CAN read own org A commission tariff chain', async () => {
    const { client, orgA, storeA } = await twoTenantsSetup();
    const { tariff, period, item } = await seedTariffChain(orgA.id, storeA.id);

    const tariffs = await client.from('commission_tariffs').select('id,name');
    const periods = await client.from('commission_tariff_periods').select('id');
    const items = await client.from('commission_tariff_items').select('id,barcode');

    expect(tariffs.error).toBeNull();
    expect(tariffs.data?.map((r) => r.id)).toEqual([tariff.id]);
    expect(periods.data?.map((r) => r.id)).toEqual([period.id]);
    expect(items.data?.map((r) => r.id)).toEqual([item.id]);
  });
});
