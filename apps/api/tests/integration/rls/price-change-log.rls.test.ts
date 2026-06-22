import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createPriceChangeLog,
  createProduct,
  createProductVariant,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * price_change_logs: store-scoped via store_id — the policy is a direct
 * can_access_store(store_id) gate, matching the orders / sync_logs /
 * catalog_barcode_miss pattern. Rows are inserted only by the backend
 * (postgres role, RLS-bypassed); authenticated clients can only SELECT.
 * Tests assert: own-org row visible, sibling-org row invisible, and a
 * MEMBER without a store grant sees nothing (store-access-awareness).
 */
describe('RLS — price_change_logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only PriceChangeLog rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);

    const [productA, productB] = await Promise.all([
      createProduct(orgA.id, storeA.id),
      createProduct(orgB.id, storeB.id),
    ]);
    const [variantA, variantB] = await Promise.all([
      createProductVariant(orgA.id, storeA.id, productA.id),
      createProductVariant(orgB.id, storeB.id, productB.id),
    ]);

    const [logA] = await Promise.all([
      createPriceChangeLog(orgA.id, storeA.id, variantA.id, userA.id),
      createPriceChangeLog(orgB.id, storeB.id, variantB.id, userB.id),
    ]);

    const { data, error } = await client.from('price_change_logs').select('id,status');

    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual([logA.id]);
  });

  it('MEMBER without a store grant sees no price_change_logs of that store', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const store = await createStore(org.id);
    const product = await createProduct(org.id, store.id);
    const variant = await createProductVariant(org.id, store.id, product.id);
    await createPriceChangeLog(org.id, store.id, variant.id, user.id);

    const { data, error } = await client.from('price_change_logs').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
