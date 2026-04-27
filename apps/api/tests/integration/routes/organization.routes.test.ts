import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('GET /v1/organizations', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const res = await app.request('/v1/organizations');
    expect(res.status).toBe(401);
  });

  it('returns an empty list for a user with no memberships', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns the orgs the user is a member of, in name order', async () => {
    const user = await createAuthenticatedTestUser();
    const [orgA, orgB] = await Promise.all([
      createOrganization({ name: 'Beta Corp', slug: 'beta' }),
      createOrganization({ name: 'Alpha Corp', slug: 'alpha' }),
    ]);
    await Promise.all([
      createMembership(orgA.id, user.id, 'OWNER'),
      createMembership(orgB.id, user.id, 'MEMBER'),
    ]);

    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string; slug: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data.map((o) => o.name)).toEqual(['Alpha Corp', 'Beta Corp']);
  });

  it("returns the caller's role, store count, lastSyncedAt and lastAccessedAt per org", async () => {
    const user = await createAuthenticatedTestUser();

    // Org A: caller is OWNER, 2 stores, latest sync today.
    const orgA = await createOrganization({ name: 'Alpha Corp', slug: 'alpha-1' });
    await createMembership(orgA.id, user.id, 'OWNER');
    const recentSync = new Date('2026-04-26T15:00:00Z');
    const olderSync = new Date('2026-04-20T09:00:00Z');
    const storeAOne = await createStore(orgA.id, { name: 'Store A1' });
    const storeATwo = await createStore(orgA.id, { name: 'Store A2', platform: 'HEPSIBURADA' });
    await prisma.store.update({ where: { id: storeAOne.id }, data: { lastSyncAt: olderSync } });
    await prisma.store.update({ where: { id: storeATwo.id }, data: { lastSyncAt: recentSync } });

    // Org B: caller is MEMBER, no stores, never accessed.
    const orgB = await createOrganization({ name: 'Beta Corp', slug: 'beta-1' });
    await createMembership(orgB.id, user.id, 'MEMBER');

    // Mark Org A as last accessed by the caller.
    const accessedAt = new Date('2026-04-25T12:00:00Z');
    await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgA.id, userId: user.id } },
      data: { lastAccessedAt: accessedAt },
    });

    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        role: string;
        storeCount: number;
        lastSyncedAt: string | null;
        lastAccessedAt: string | null;
      }>;
    };
    const a = body.data.find((o) => o.id === orgA.id);
    const b = body.data.find((o) => o.id === orgB.id);
    expect(a).toMatchObject({
      role: 'OWNER',
      storeCount: 2,
      lastSyncedAt: recentSync.toISOString(),
      lastAccessedAt: accessedAt.toISOString(),
    });
    expect(b).toMatchObject({
      role: 'MEMBER',
      storeCount: 0,
      lastSyncedAt: null,
      lastAccessedAt: null,
    });
  });

  it("uses the caller's own role and lastAccessedAt — not another member's", async () => {
    const [callerOwner, callerMember] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    const org = await createOrganization({ name: 'Shared Corp', slug: 'shared-1' });
    await Promise.all([
      createMembership(org.id, callerOwner.id, 'OWNER'),
      createMembership(org.id, callerMember.id, 'MEMBER'),
    ]);
    // Owner accessed it, member never has.
    await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: callerOwner.id } },
      data: { lastAccessedAt: new Date('2026-04-25T10:00:00Z') },
    });

    const memberRes = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(callerMember.accessToken) },
    });
    const memberBody = (await memberRes.json()) as {
      data: Array<{ role: string; lastAccessedAt: string | null }>;
    };
    expect(memberBody.data[0]).toMatchObject({ role: 'MEMBER', lastAccessedAt: null });

    const ownerRes = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(callerOwner.accessToken) },
    });
    const ownerBody = (await ownerRes.json()) as {
      data: Array<{ role: string; lastAccessedAt: string | null }>;
    };
    expect(ownerBody.data[0]).toMatchObject({
      role: 'OWNER',
      lastAccessedAt: '2026-04-25T10:00:00.000Z',
    });
  });
});

describe('POST /v1/organizations', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  it('creates org + OWNER membership and returns the pair', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(user.accessToken),
      },
      body: JSON.stringify({ name: 'Akyıldız Ticaret' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      slug: string;
      currency: string;
      timezone: string;
      membership: { role: string };
    };
    expect(body.name).toBe('Akyıldız Ticaret');
    expect(body.slug).toBe('akyildiz-ticaret');
    expect(body.currency).toBe('TRY');
    expect(body.timezone).toBe('Europe/Istanbul');
    expect(body.membership.role).toBe('OWNER');

    // Verify the membership row was persisted.
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: body.id, userId: user.id } },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('OWNER');
  });

  it('appends a numeric suffix to resolve a slug collision', async () => {
    const user = await createAuthenticatedTestUser();
    await createOrganization({ name: 'Other', slug: 'akyildiz-ticaret' });

    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(user.accessToken),
      },
      body: JSON.stringify({ name: 'Akyıldız Ticaret' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe('akyildiz-ticaret-2');
  });

  it('rejects a too-short name with VALIDATION_ERROR', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(user.accessToken),
      },
      body: JSON.stringify({ name: 'A' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      errors: Array<{ field: string; code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toHaveLength(1);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', code: 'INVALID_NAME_TOO_SHORT' }),
      ]),
    );
  });

  it('rejects a reserved name with VALIDATION_ERROR', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(user.accessToken),
      },
      body: JSON.stringify({ name: 'admin' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: Array<{ code: string }> };
    expect(body.errors.map((e) => e.code)).toContain('INVALID_NAME_RESERVED');
  });

  it('lets the same user create multiple organizations', async () => {
    const user = await createAuthenticatedTestUser();

    for (const name of ['First Org', 'Second Org']) {
      const res = await app.request('/v1/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(201);
    }

    const listRes = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(user.accessToken) },
    });
    const body = (await listRes.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((o) => o.name).sort()).toEqual(['First Org', 'Second Org']);
  });
});
