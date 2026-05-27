import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';

/**
 * Tenant isolation for member-management routes: an OWNER of one org has no
 * standing in another. The capability gate resolves the caller's role in the
 * URL's org — a non-member resolves to none → 403 — so cross-org management is
 * blocked before any member/store row is touched.
 */
describe('Tenant isolation — member-management routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function ownerAndForeignOrg() {
    const owner = await createAuthenticatedTestUser();
    const orgA = await createOrganization({ name: 'A' });
    await createMembership(orgA.id, owner.id, 'OWNER');

    const orgB = await createOrganization({ name: 'B' });
    const bUser = await createUserProfile();
    const bMember = await createMembership(orgB.id, bUser.id, 'MEMBER');
    return { owner, orgB, bMember };
  }

  it("OWNER of A cannot list B's roster", async () => {
    const { owner, orgB } = await ownerAndForeignOrg();
    const res = await app.request(`/v1/organizations/${orgB.id}/members`, {
      headers: { Authorization: bearer(owner.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it('OWNER of A cannot change a role in B', async () => {
    const { owner, orgB, bMember } = await ownerAndForeignOrg();
    const res = await app.request(`/v1/organizations/${orgB.id}/members/${bMember.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(owner.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    });
    expect(res.status).toBe(403);
  });

  it('OWNER of A cannot grant store access in B', async () => {
    const { owner, orgB, bMember } = await ownerAndForeignOrg();
    const bStore = await createStore(orgB.id);
    const res = await app.request(
      `/v1/organizations/${orgB.id}/members/${bMember.id}/store-access`,
      {
        method: 'PUT',
        headers: { Authorization: bearer(owner.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeIds: [bStore.id] }),
      },
    );
    expect(res.status).toBe(403);
  });
});
