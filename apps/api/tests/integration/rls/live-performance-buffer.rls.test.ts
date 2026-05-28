import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * live_performance_buffer: store-scoped via can_access_store(store_id) — same
 * gate as orders / sync_logs (PR #218). The axis worth proving: a MEMBER
 * granted store A never sees store B's buffer; OWNER/ADMIN see every store's
 * buffer in their org; a member of another org sees nothing.
 */
describe('RLS — live_performance_buffer (can_access_store)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('MEMBER sees buffer rows only for granted stores, not ungranted in the same org', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const [granted, ungranted] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await createMemberStoreAccess(org.id, member.id, granted.id);
    const [grantedEntry] = await Promise.all([
      createBufferEntry(org.id, granted.id),
      createBufferEntry(org.id, ungranted.id),
    ]);

    const { data, error } = await client.from('live_performance_buffer').select('id, store_id');

    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([grantedEntry.id]);
  });

  it('OWNER sees buffer rows for every store in the org without grant rows', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const [s1, s2] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await Promise.all([createBufferEntry(org.id, s1.id), createBufferEntry(org.id, s2.id)]);

    const { data, error } = await client.from('live_performance_buffer').select('id');

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(2);
  });

  it('VIEWER with zero grants sees no buffer rows (panel-access gate)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'VIEWER');
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id);

    const { data, error } = await client.from('live_performance_buffer').select('id');

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a member of another org sees nothing (cross-org isolation)', async () => {
    const { user, client } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id, 'OWNER');

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await createBufferEntry(orgB.id, storeB.id);

    const { data, error } = await client.from('live_performance_buffer').select('id');

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
