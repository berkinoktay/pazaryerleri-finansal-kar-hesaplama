import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

describe('Tenant isolation — POST /v1/organizations/:orgId/access', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("user A cannot update user B's membership timestamp", async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    const orgB = await createOrganization({ name: 'B Corp' });
    await createMembership(orgB.id, userB.id, 'OWNER');

    const before = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgB.id, userId: userB.id } },
    });

    const res = await app.request(`/v1/organizations/${orgB.id}/access`, {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken) },
    });

    // SECURITY.md §3 — existence non-disclosure: 404, not 403, so user A
    // cannot tell whether the org exists.
    expect(res.status).toBe(404);

    const after = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgB.id, userId: userB.id } },
    });
    // User B's row is untouched — neither lastAccessedAt nor updatedAt drifted.
    expect(after?.lastAccessedAt).toEqual(before?.lastAccessedAt);
    expect(after?.updatedAt.getTime()).toEqual(before?.updatedAt.getTime());
  });

  it("user A's update under their own org does not bleed into user B's row", async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    // Both users belong to the same org — exercise the WHERE clause's
    // (organizationId, userId) tuple rather than just orgId.
    const sharedOrg = await createOrganization({ name: 'Shared Corp' });
    await Promise.all([
      createMembership(sharedOrg.id, userA.id, 'OWNER'),
      createMembership(sharedOrg.id, userB.id, 'MEMBER'),
    ]);

    const userBBefore = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: sharedOrg.id, userId: userB.id } },
    });

    const res = await app.request(`/v1/organizations/${sharedOrg.id}/access`, {
      method: 'POST',
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(res.status).toBe(204);

    // User B's lastAccessedAt must be unchanged — only user A's timestamp moved.
    const userBAfter = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: sharedOrg.id, userId: userB.id } },
    });
    expect(userBAfter?.lastAccessedAt).toEqual(userBBefore?.lastAccessedAt);

    const userAAfter = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: sharedOrg.id, userId: userA.id } },
    });
    expect(userAAfter?.lastAccessedAt).not.toBeNull();
  });
});
