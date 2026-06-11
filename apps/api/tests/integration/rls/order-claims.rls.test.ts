import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * order_claims: store-scoped via the denormalized store_id (#298) — the
 * policy is a direct can_access_store(store_id) gate, sync_logs pattern.
 * The old parent-walk through orders is gone; the sync worker stamps
 * store_id from the parent order on every insert. The tests assert
 * observable behavior: own-org visible, sibling-org invisible, and a
 * MEMBER without a store grant sees nothing (store-access-awareness).
 */
describe('RLS — order_claims', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only OrderClaim rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [orderA, orderB] = await Promise.all([
      createOrder(orgA.id, storeA.id),
      createOrder(orgB.id, storeB.id),
    ]);
    const [claimA] = await Promise.all([
      createOrderClaim(orgA.id, storeA.id, orderA.id),
      createOrderClaim(orgB.id, storeB.id, orderB.id),
    ]);

    const { data, error } = await client.from('order_claims').select('id,trendyol_claim_id');

    expect(error).toBeNull();
    expect(data?.map((c) => c.id)).toEqual([claimA.id]);
  });

  it('MEMBER without a store grant sees no claims of that store', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);
    await createOrderClaim(org.id, store.id, order.id);

    const { data, error } = await client.from('order_claims').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
