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
