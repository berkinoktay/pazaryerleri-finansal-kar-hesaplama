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

describe('RLS — flash_product_lists (+ items)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // Two-tenant fixture: only userA authenticates (scoped client); orgB is a
  // valid OWNER'd tenant whose private Flash Products data userA must not see.
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

  // Seeded via Prisma (postgres role bypasses RLS) — a list → item chain, both
  // carrying the tenant's store_id.
  async function seedFlashChain(organizationId: string, storeId: string) {
    const list = await prisma.flashProductList.create({
      data: { organizationId, storeId, name: 'Flaş Ürünler' },
    });
    const item = await prisma.flashProductItem.create({
      data: {
        organizationId,
        storeId,
        listId: list.id,
        barcode: 'TB100X150A',
        productTitle: '100x150 Cm Kumaş Türk Bayrağı',
        currentPrice: '360.00',
        customerPrice: '360.00',
        currentCommissionPct: '19',
        hasCommissionTariff: true,
        offer24Price: '260.00',
        sortOrder: 0,
      },
    });
    return { list, item };
  }

  it('org A user CANNOT read org B Flash Products chain', async () => {
    const { client, orgB, storeB } = await twoTenantsSetup();
    await seedFlashChain(orgB.id, storeB.id);

    const lists = await client.from('flash_product_lists').select('id');
    const items = await client.from('flash_product_items').select('id');

    expect(lists.error).toBeNull();
    expect(lists.data?.map((r) => r.id)).toEqual([]);
    expect(items.data?.map((r) => r.id)).toEqual([]);
  });

  it('org A user CAN read own org A Flash Products chain', async () => {
    const { client, orgA, storeA } = await twoTenantsSetup();
    const { list, item } = await seedFlashChain(orgA.id, storeA.id);

    const lists = await client.from('flash_product_lists').select('id,name');
    const items = await client.from('flash_product_items').select('id,barcode');

    expect(lists.error).toBeNull();
    expect(lists.data?.map((r) => r.id)).toEqual([list.id]);
    expect(items.data?.map((r) => r.id)).toEqual([item.id]);
  });
});
