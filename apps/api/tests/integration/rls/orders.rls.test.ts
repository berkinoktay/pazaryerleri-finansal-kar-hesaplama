import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * orders: store-scoped via can_access_store(store_id) — same gate as
 * live_performance_buffer / sync_logs (PR #218). Realtime respects table RLS,
 * so publishing orders (Slice D) is only safe if a cross-org user sees zero
 * rows and a MEMBER sees only granted stores.
 */
describe('RLS — orders (can_access_store)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('a member of another org sees zero orders', async () => {
    const { client } = await createRlsScopedClient();
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await createOrder(orgB.id, storeB.id);

    const { data, error } = await client.from('orders').select('id');

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('MEMBER sees orders only for granted stores, not ungranted in the same org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const [granted, ungranted] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await createMemberStoreAccess(org.id, member.id, granted.id);
    const [grantedOrder] = await Promise.all([
      createOrder(org.id, granted.id),
      createOrder(org.id, ungranted.id),
    ]);

    const { data, error } = await client.from('orders').select('id, store_id');

    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([grantedOrder.id]);
  });

  it('OWNER sees every order in the org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const [s1, s2] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await Promise.all([createOrder(org.id, s1.id), createOrder(org.id, s2.id)]);

    const { data, error } = await client.from('orders').select('id');

    expect(error).toBeNull();
    expect((data ?? []).length).toBe(2);
  });
});
