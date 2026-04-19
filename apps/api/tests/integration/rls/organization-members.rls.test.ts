import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — organization_members', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user can read own membership rows', async () => {
    const { user, client } = await createRlsScopedClient();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, user.id, 'OWNER');
    await createMembership(orgB.id, user.id, 'MEMBER');

    const { data, error } = await client.from('organization_members').select('role');

    expect(error).toBeNull();
    expect(data?.map((m) => m.role).sort()).toEqual(['MEMBER', 'OWNER']);
  });

  it('user can read other members of an org they belong to', async () => {
    const { user: self, client } = await createRlsScopedClient();
    const coworker = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, self.id, 'OWNER');
    await createMembership(org.id, coworker.id, 'MEMBER');

    const { data, error } = await client
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id);

    expect(error).toBeNull();
    expect(data?.map((m) => m.user_id).sort()).toEqual([coworker.id, self.id].sort());
  });

  it('user CANNOT read memberships of an org they do not belong to', async () => {
    const { client } = await createRlsScopedClient();
    const stranger = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, stranger.id, 'OWNER');

    const { data, error } = await client
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
