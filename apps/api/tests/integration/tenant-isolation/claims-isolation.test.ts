import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderClaim,
  createOrganization,
  createStore,
} from '../../helpers/factories';

async function createBareClaim(orgId: string, storeId: string): Promise<{ claimId: string }> {
  const order = await createOrder(orgId, storeId);
  const claim = await createOrderClaim(orgId, storeId, order.id);
  return { claimId: claim.id };
}

/**
 * Multi-tenancy invariant: a member of org A MUST NOT see claims that belong
 * to org B — even by guessing B's storeId. 403 on foreign org in the URL;
 * 404 (existence non-disclosure) on a foreign storeId under their own org.
 */
describe('Claims — tenant isolation', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('LIST: 403 when caller targets an org they do not belong to', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(`/v1/organizations/${orgB.id}/stores/${storeB.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it('LIST: 404 when caller targets their own org but a sibling org storeId', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await createBareClaim(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeB.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(404); // existence non-disclosure
  });

  it('LIST: a member of two orgs only sees claims for the org they query', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    await createMembership(orgB.id, user.id);
    const storeA = await createStore(orgA.id);
    const storeB = await createStore(orgB.id);
    const claimA = await createBareClaim(orgA.id, storeA.id);
    await createBareClaim(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[]; counts: { all: number } };
    expect(body.data.map((c) => c.id)).toEqual([claimA.claimId]);
    expect(body.counts.all).toBe(1);
  });

  it('SUMMARY: 403 on foreign org, 404 on foreign storeId under own org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const foreignOrg = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/claims/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(foreignOrg.status).toBe(403);

    const foreignStore = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/claims/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(foreignStore.status).toBe(404);
  });
});
