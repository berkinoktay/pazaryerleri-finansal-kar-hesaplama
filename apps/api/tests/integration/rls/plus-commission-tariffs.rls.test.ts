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

describe('RLS — plus_commission_tariffs (+ items)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // Two-tenant fixture: only userA authenticates (scoped client); orgB is a
  // valid OWNER'd tenant whose private Plus tariff data userA must not see.
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

  // Seeded via Prisma (postgres role bypasses RLS) — a tariff → period → item chain,
  // all carrying the tenant's store_id.
  async function seedPlusTariffChain(organizationId: string, storeId: string) {
    const tariff = await prisma.plusCommissionTariff.create({
      data: { organizationId, storeId, name: '30 Haziran – 7 Temmuz' },
    });
    const period = await prisma.plusCommissionTariffPeriod.create({
      data: {
        organizationId,
        storeId,
        tariffId: tariff.id,
        dateRangeLabel: '30 Haziran 08.00 - 7 Temmuz 07.59',
        dayCount: 7,
        sortOrder: 0,
      },
    });
    const item = await prisma.plusCommissionTariffItem.create({
      data: {
        organizationId,
        storeId,
        periodId: period.id,
        barcode: '85697423698',
        productTitle: 'Türk Bayrağı 120×180 cm',
        currentPrice: '472.50',
        commissionBasePrice: '448.87',
        currentCommissionPct: '19.0000',
        plusPriceUpperLimit: '377.66',
        plusCommissionPct: '15.4000',
        plusCommissionBasePrice: '448.87',
        sortOrder: 0,
      },
    });
    return { tariff, period, item };
  }

  it('org A user CANNOT read org B Plus tariff chain', async () => {
    const { client, orgB, storeB } = await twoTenantsSetup();
    await seedPlusTariffChain(orgB.id, storeB.id);

    const tariffs = await client.from('plus_commission_tariffs').select('id');
    const periods = await client.from('plus_commission_tariff_periods').select('id');
    const items = await client.from('plus_commission_tariff_items').select('id');

    expect(tariffs.error).toBeNull();
    expect(tariffs.data?.map((r) => r.id)).toEqual([]);
    expect(periods.data?.map((r) => r.id)).toEqual([]);
    expect(items.data?.map((r) => r.id)).toEqual([]);
  });

  it('org A user CAN read own org A Plus tariff chain', async () => {
    const { client, orgA, storeA } = await twoTenantsSetup();
    const { tariff, period, item } = await seedPlusTariffChain(orgA.id, storeA.id);

    const tariffs = await client.from('plus_commission_tariffs').select('id,name');
    const periods = await client.from('plus_commission_tariff_periods').select('id');
    const items = await client.from('plus_commission_tariff_items').select('id,barcode');

    expect(tariffs.error).toBeNull();
    expect(tariffs.data?.map((r) => r.id)).toEqual([tariff.id]);
    expect(periods.data?.map((r) => r.id)).toEqual([period.id]);
    expect(items.data?.map((r) => r.id)).toEqual([item.id]);
  });
});
