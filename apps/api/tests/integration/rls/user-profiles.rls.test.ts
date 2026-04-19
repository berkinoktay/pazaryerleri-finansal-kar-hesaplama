import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createUserProfile } from '../../helpers/factories';
import { createAnonClient, createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — user_profiles', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user CAN read own profile', async () => {
    const { user, client } = await createRlsScopedClient({ fullName: 'Self' });

    const { data, error } = await client.from('user_profiles').select('*').eq('id', user.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.full_name).toBe('Self');
  });

  it("user CANNOT read another user's profile", async () => {
    const { client } = await createRlsScopedClient({ fullName: 'Self' });
    const other = await createUserProfile({ fullName: 'Other' });

    const { data, error } = await client.from('user_profiles').select('*').eq('id', other.id);

    // RLS filters the row — no error, just an empty result.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot read any profile', async () => {
    await createUserProfile();
    const client = createAnonClient();

    const { data, error } = await client.from('user_profiles').select('*');

    // Either an empty result or an RLS/permission error — both are denials.
    if (error === null) {
      expect(data).toEqual([]);
    }
  });
});
