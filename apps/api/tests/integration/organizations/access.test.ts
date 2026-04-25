import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

describe('POST /v1/organizations/:orgId/access', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const org = await createOrganization();
    const res = await app.request(`/v1/organizations/${org.id}/access`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it("last_accessed_at'ı update eder", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const before = new Date();

    const res = await app.request(`/v1/organizations/${org.id}/access`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(204);

    const member = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    });
    expect(member?.lastAccessedAt).not.toBeNull();
    expect(member!.lastAccessedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("başka tenant'ın org'u için 404 döner", async () => {
    const user = await createAuthenticatedTestUser();
    const otherUser = await createAuthenticatedTestUser();
    const otherOrg = await createOrganization();
    await createMembership(otherOrg.id, otherUser.id, 'OWNER');

    const res = await app.request(`/v1/organizations/${otherOrg.id}/access`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 when org doesn't exist", async () => {
    const user = await createAuthenticatedTestUser();
    const nonexistentOrgId = '00000000-0000-0000-0000-000000000000';

    const res = await app.request(`/v1/organizations/${nonexistentOrgId}/access`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(404);
  });
});
