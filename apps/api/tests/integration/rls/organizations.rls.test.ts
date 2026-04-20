import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — organizations', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member CAN read their organization', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization({ name: 'Alpha' });
    await createMembership(org.id, user.id, 'OWNER');

    const { data, error } = await client.from('organizations').select('*').eq('id', org.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe('Alpha');
  });

  it("non-member CANNOT see an organization they don't belong to", async () => {
    const { client } = await createRlsScopedClient();
    const otherUser = await createUserProfile();
    const orgB = await createOrganization({ name: 'Only-B' });
    await createMembership(orgB.id, otherUser.id, 'OWNER');

    const { data, error } = await client.from('organizations').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('user sees only the orgs they are a member of, not all', async () => {
    const { user, client } = await createRlsScopedClient();
    const [mine, theirs] = await Promise.all([
      createOrganization({ name: 'Mine' }),
      createOrganization({ name: 'Theirs' }),
    ]);
    await createMembership(mine.id, user.id, 'OWNER');

    const { data, error } = await client.from('organizations').select('name');

    expect(error).toBeNull();
    expect(data?.map((o) => o.name)).toEqual(['Mine']);
    // Paranoid: "Theirs" must not even appear as substring
    expect(JSON.stringify(data)).not.toContain(theirs.name);
  });

  it('authenticated client CANNOT INSERT directly — writes are API-only', async () => {
    // organizations has no INSERT policy for the `authenticated` role,
    // so default-deny applies. This locks first-membership atomicity
    // and future billing/VKN write paths to the Hono API (Prisma via
    // DATABASE_URL runs as postgres and bypasses RLS).
    const { client } = await createRlsScopedClient();

    const { error } = await client
      .from('organizations')
      .insert({ name: 'Should Fail', slug: 'should-fail' });

    expect(error).not.toBeNull();
  });

  it('authenticated client CANNOT UPDATE an existing org — writes are API-only', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization({ name: 'Original' });
    await createMembership(org.id, user.id, 'OWNER');

    const { data, error } = await client
      .from('organizations')
      .update({ name: 'Tampered' })
      .eq('id', org.id)
      .select();

    // No UPDATE policy means the filter returns zero affected rows
    // (or an explicit error). Either way the org is unchanged.
    if (error === null) {
      expect(data).toEqual([]);
    }
  });
});
