import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';

/**
 * Member-management API: roster read, role change (last-owner guard), store-
 * access grant replace, and the org-scoped membership context (/me). All gated
 * by capability — MEMBER/VIEWER cannot manage; only OWNER changes roles.
 */
describe('Member management', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('GET /members — OWNER lists the roster with accessible store ids', async () => {
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, owner.id, 'OWNER');
    const memberUser = await createUserProfile();
    const member = await createMembership(org.id, memberUser.id, 'MEMBER');
    const store = await createStore(org.id);
    await createMemberStoreAccess(org.id, member.id, store.id);

    const res = await app.request(`/v1/organizations/${org.id}/members`, {
      headers: { Authorization: bearer(owner.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { userId: string; role: string; accessibleStoreIds: string[] | null }[];
    };
    const ownerRow = body.data.find((m) => m.userId === owner.id);
    const memberRow = body.data.find((m) => m.userId === memberUser.id);
    expect(ownerRow?.role).toBe('OWNER');
    expect(ownerRow?.accessibleStoreIds).toBeNull(); // OWNER sees all → null
    expect(memberRow?.role).toBe('MEMBER');
    expect(memberRow?.accessibleStoreIds).toEqual([store.id]);
  });

  it('GET /members — MEMBER lacks members:read → 403', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');

    const res = await app.request(`/v1/organizations/${org.id}/members`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
  });

  it('GET /me — returns role, capabilities and accessible store ids', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    const store = await createStore(org.id);
    await createMemberStoreAccess(org.id, member.id, store.id);

    const res = await app.request(`/v1/organizations/${org.id}/me`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      role: string;
      capabilities: string[];
      accessibleStoreIds: string[] | null;
    };
    expect(body.role).toBe('MEMBER');
    expect(body.capabilities).toContain('data:read');
    expect(body.capabilities).not.toContain('stores:connect');
    expect(body.accessibleStoreIds).toEqual([store.id]);
  });

  it('PATCH /members/:memberId — OWNER promotes a MEMBER to ADMIN', async () => {
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, owner.id, 'OWNER');
    const memberUser = await createUserProfile();
    const member = await createMembership(org.id, memberUser.id, 'MEMBER');

    const res = await app.request(`/v1/organizations/${org.id}/members/${member.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(owner.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; accessibleStoreIds: string[] | null };
    expect(body.role).toBe('ADMIN');
    expect(body.accessibleStoreIds).toBeNull(); // ADMIN sees all
  });

  it('PATCH /members/:memberId — demoting the last OWNER is rejected', async () => {
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const ownerMember = await createMembership(org.id, owner.id, 'OWNER');

    const res = await app.request(`/v1/organizations/${org.id}/members/${ownerMember.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(owner.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors?: { code: string }[] };
    expect(body.errors?.[0]?.code).toBe('CANNOT_DEMOTE_LAST_OWNER');
  });

  it('PATCH /members/:memberId — MEMBER lacks members:manage_roles → 403', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const targetUser = await createUserProfile();
    const target = await createMembership(org.id, targetUser.id, 'VIEWER');

    const res = await app.request(`/v1/organizations/${org.id}/members/${target.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    });

    expect(res.status).toBe(403);
  });

  it('PUT /members/:memberId/store-access — OWNER replaces the grant set', async () => {
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, owner.id, 'OWNER');
    const memberUser = await createUserProfile();
    const member = await createMembership(org.id, memberUser.id, 'MEMBER');
    const [s1, s2] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await createMemberStoreAccess(org.id, member.id, s1.id); // pre-existing grant, should be replaced

    const res = await app.request(`/v1/organizations/${org.id}/members/${member.id}/store-access`, {
      method: 'PUT',
      headers: { Authorization: bearer(owner.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeIds: [s2.id] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessibleStoreIds: string[] | null };
    expect(body.accessibleStoreIds).toEqual([s2.id]); // replaced: s1 gone, s2 present
  });

  it('PUT /members/:memberId/store-access — a store from another org is rejected', async () => {
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, owner.id, 'OWNER');
    const memberUser = await createUserProfile();
    const member = await createMembership(org.id, memberUser.id, 'MEMBER');
    const otherOrg = await createOrganization();
    const foreignStore = await createStore(otherOrg.id);

    const res = await app.request(`/v1/organizations/${org.id}/members/${member.id}/store-access`, {
      method: 'PUT',
      headers: { Authorization: bearer(owner.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeIds: [foreignStore.id] }),
    });

    expect(res.status).toBe(422);
  });
});
