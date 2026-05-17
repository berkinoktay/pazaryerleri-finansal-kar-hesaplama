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

describe('RLS — own_shipping_tariffs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * Two-tenant fixture:
   *   userA is OWNER of orgA; userB is OWNER of orgB.
   *   Only userA authenticates (gets a scoped client). userB is just a
   *   profile row so orgB has a valid OWNER — RLS verification runs from
   *   userA's perspective via the scoped Supabase client.
   *
   * Mirrors the helper at `org-scoped-tables.rls.test.ts` so the two
   * shipping cases below stay consistent with sibling RLS tests.
   */
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

  it('org A user CANNOT read org B own_shipping_tariffs', async () => {
    const { client, orgB, storeB } = await twoTenantsSetup();

    // Seeded via Prisma (postgres role bypasses RLS) — represents orgB's
    // private negotiated carrier rate that userA must not see.
    await prisma.ownShippingTariff.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        desi: 1,
        priceNet: '24.50',
      },
    });

    const { data, error } = await client.from('own_shipping_tariffs').select('id,desi,price_net');

    // RLS filters the row — no error, just an empty result.
    expect(error).toBeNull();
    expect(data?.map((t) => t.id)).toEqual([]);
  });

  it('org A user CAN read own org A own_shipping_tariffs', async () => {
    const { client, orgA, storeA } = await twoTenantsSetup();

    const tariffA = await prisma.ownShippingTariff.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        desi: 1,
        priceNet: '22.00',
      },
    });

    const { data, error } = await client.from('own_shipping_tariffs').select('id,desi,price_net');

    expect(error).toBeNull();
    expect(data?.map((t) => t.id)).toEqual([tariffA.id]);
    expect(data?.[0]?.desi).toBe(1);
  });
});
