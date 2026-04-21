import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

describe('Tenant isolation — stores', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user not in the org gets 403 when listing stores', async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createStore(orgA.id);

    // User B is authenticated but not a member of orgA.
    const res = await app.request(`/v1/organizations/${orgA.id}/stores`, {
      headers: { Authorization: bearer(userB.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it("user from another org cannot read org A's specific store (403 at membership check)", async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const orgAStore = await createStore(orgA.id);

    // User B hits org A's URL — the org-context middleware blocks with 403
    // because user B is not a member of org A.
    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${orgAStore.id}`, {
      headers: { Authorization: bearer(userB.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it("user cannot reach another org's store via their OWN org's URL (404 non-disclosure)", async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const orgAStore = await createStore(orgA.id);

    // User B passes membership (their own org), but tries to fetch a store
    // id belonging to org A. Service layer must 404, not 403 — existence
    // non-disclosure per SECURITY.md §3.
    const res = await app.request(`/v1/organizations/${orgB.id}/stores/${orgAStore.id}`, {
      headers: { Authorization: bearer(userB.accessToken) },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE through another org URL does not delete the real row', async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const orgAStore = await createStore(orgA.id);

    const res = await app.request(`/v1/organizations/${orgB.id}/stores/${orgAStore.id}`, {
      method: 'DELETE',
      headers: { Authorization: bearer(userB.accessToken) },
    });
    expect(res.status).toBe(404);

    // The store must still be there.
    const still = await prisma.store.findUnique({ where: { id: orgAStore.id } });
    expect(still).not.toBeNull();
  });
});
