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
 * Store-level visibility via the can_access_store() RLS helper.
 *
 * Cross-org isolation is covered by org-scoped-tables.rls.test.ts (OWNER sees
 * only own org). These tests cover the INTRA-org axis introduced by
 * member-store-access: OWNER/ADMIN see every store in their org, MEMBER/VIEWER
 * see only the stores they were explicitly granted, and a member with zero
 * grants sees nothing (the panel-access gate).
 */
describe('RLS — member store-access (can_access_store)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('MEMBER sees only granted stores, not ungranted stores in the same org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const [granted, ungranted] = await Promise.all([
      createStore(org.id, { name: 'Granted' }),
      createStore(org.id, { name: 'Ungranted' }),
    ]);
    await createMemberStoreAccess(org.id, member.id, granted.id);

    const { data, error } = await client.from('stores').select('id');

    expect(error).toBeNull();
    const ids = (data ?? []).map((s) => s.id);
    expect(ids).toContain(granted.id);
    expect(ids).not.toContain(ungranted.id);
  });

  it('VIEWER with zero grants sees no stores (panel-access gate)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'VIEWER');
    await createStore(org.id);

    const { data, error } = await client.from('stores').select('id');

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('OWNER sees all stores in the org without any grant rows', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const [s1, s2] = await Promise.all([createStore(org.id), createStore(org.id)]);

    const { data, error } = await client.from('stores').select('id');

    expect(error).toBeNull();
    const ids = (data ?? []).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([s1.id, s2.id]));
    expect(ids).toHaveLength(2);
  });

  it('ADMIN sees all stores in the org without any grant rows', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'ADMIN');
    const [s1, s2] = await Promise.all([createStore(org.id), createStore(org.id)]);

    const { data, error } = await client.from('stores').select('id');

    expect(error).toBeNull();
    const ids = (data ?? []).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([s1.id, s2.id]));
    expect(ids).toHaveLength(2);
  });

  it('MEMBER cannot see orders of an ungranted store in the same org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const [granted, ungranted] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await createMemberStoreAccess(org.id, member.id, granted.id);
    const [grantedOrder] = await Promise.all([
      createOrder(org.id, granted.id),
      createOrder(org.id, ungranted.id),
    ]);

    const { data, error } = await client.from('orders').select('id');

    expect(error).toBeNull();
    expect((data ?? []).map((o) => o.id)).toEqual([grantedOrder.id]);
  });

  it('grants are visible to co-members of the org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const grant = await createMemberStoreAccess(org.id, member.id, store.id);

    const { data, error } = await client.from('member_store_access').select('id');

    expect(error).toBeNull();
    expect((data ?? []).map((g) => g.id)).toContain(grant.id);
  });
});
