import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * Multi-tenancy invariant for catalog_barcode_miss (DB-layer table, no API route
 * yet — later tasks consume it). The gate is store-scoped via
 * can_access_store(store_id), the same SECURITY DEFINER helper as orders /
 * sync_logs / live_performance_buffer (#218).
 *
 * Prisma (DATABASE_URL) connects as the `postgres` superuser and bypasses RLS,
 * so it is used ONLY to seed rows. The assertion is made through an RLS-scoped
 * Supabase client whose JWT maps to `SET ROLE authenticated` + auth.uid() — the
 * only path that proves the policy enforces.
 */
async function createCatalogBarcodeMiss(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<{ id: string }> {
  return prisma.catalogBarcodeMiss.create({
    data: { organizationId, storeId, barcode, vendorMissing: true },
    select: { id: true },
  });
}

describe('CatalogBarcodeMiss — tenant isolation (can_access_store)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("a member of org B cannot see a CatalogBarcodeMiss row that belongs to org A's store", async () => {
    // Org A owns the miss row.
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    await createCatalogBarcodeMiss(orgA.id, storeA.id, '8680000000001');

    // Org B is a fully separate tenant; its scoped client must see nothing.
    const { user: userB, client: clientB } = await createRlsScopedClient();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id, 'OWNER');

    const { data, error } = await clientB
      .from('catalog_barcode_miss')
      .select('id, store_id, barcode');

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('OWNER sees miss rows for every store in their own org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const [s1, s2] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await Promise.all([
      createCatalogBarcodeMiss(org.id, s1.id, '8680000000001'),
      createCatalogBarcodeMiss(org.id, s2.id, '8680000000002'),
    ]);

    const { data, error } = await client.from('catalog_barcode_miss').select('id');

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(2);
  });

  it('MEMBER sees miss rows only for granted stores, not ungranted ones in the same org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const [granted, ungranted] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await createMemberStoreAccess(org.id, member.id, granted.id);
    const grantedMiss = await createCatalogBarcodeMiss(org.id, granted.id, '8680000000001');
    await createCatalogBarcodeMiss(org.id, ungranted.id, '8680000000002');

    const { data, error } = await client.from('catalog_barcode_miss').select('id, store_id');

    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([grantedMiss.id]);
  });
});
