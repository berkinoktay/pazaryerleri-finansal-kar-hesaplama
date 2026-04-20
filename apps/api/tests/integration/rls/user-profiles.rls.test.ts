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

  it('user CAN update own profile (timezone, preferred_language)', async () => {
    const { user, client } = await createRlsScopedClient();

    const { data, error } = await client
      .from('user_profiles')
      .update({ timezone: 'Europe/Berlin', preferred_language: 'en' })
      .eq('id', user.id)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.timezone).toBe('Europe/Berlin');
    expect(data?.[0]?.preferred_language).toBe('en');
  });

  it("user CANNOT update another user's profile", async () => {
    const { client } = await createRlsScopedClient();
    const other = await createUserProfile();

    const { data, error } = await client
      .from('user_profiles')
      .update({ timezone: 'Europe/Berlin' })
      .eq('id', other.id)
      .select();

    // RLS filters the UPDATE to zero rows — no error, but no change applied.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('user CANNOT insert a profile with a foreign id', async () => {
    const { client } = await createRlsScopedClient();
    const foreignId = '00000000-0000-0000-0000-000000000001';

    const { error } = await client
      .from('user_profiles')
      .insert({ id: foreignId, email: 'attacker@example.com' });

    // WITH CHECK (id = auth.uid()) rejects this — Supabase returns an
    // RLS violation error on the INSERT path (unlike UPDATE which
    // silently filters).
    expect(error).not.toBeNull();
  });
});
