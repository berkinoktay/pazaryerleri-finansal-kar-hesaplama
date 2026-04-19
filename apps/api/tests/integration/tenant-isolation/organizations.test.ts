import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, signTestJwt } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../helpers/factories';

describe('Tenant isolation — GET /v1/organizations', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("user A CANNOT see user B's organizations", async () => {
    const [userA, userB] = await Promise.all([createUserProfile(), createUserProfile()]);
    const [orgA, orgB] = await Promise.all([
      createOrganization({ name: 'A Corp' }),
      createOrganization({ name: 'B Corp' }),
    ]);
    await Promise.all([
      createMembership(orgA.id, userA.id, 'OWNER'),
      createMembership(orgB.id, userB.id, 'OWNER'),
    ]);

    const tokenA = await signTestJwt(userA.id);
    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(tokenA) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe(orgA.id);
    expect(body.data[0]!.name).toBe('A Corp');

    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain(orgB.id);
    expect(responseText).not.toContain('B Corp');
  });

  it("a user with no memberships sees nobody else's orgs", async () => {
    const [lurker, owner] = await Promise.all([createUserProfile(), createUserProfile()]);
    const org = await createOrganization({ name: 'Private Corp' });
    await createMembership(org.id, owner.id, 'OWNER');

    const token = await signTestJwt(lurker.id);
    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
