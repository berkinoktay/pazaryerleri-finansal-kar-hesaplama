import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

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
