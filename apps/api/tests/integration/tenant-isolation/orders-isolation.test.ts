import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/**
 * Multi-tenancy invariant: an authenticated member of org A MUST NOT see orders
 * that belong to org B — even if A guesses B's storeId or orderId.
 *
 * Two boundaries are exercised:
 *   1. Org-level check: caller passes orgB in the URL → 403 FORBIDDEN.
 *   2. Cross-tenant store/order: caller passes orgA in the URL but a storeId/
 *      orderId that lives under orgB → 404 NOT_FOUND (existence non-disclosure).
 */
describe('Orders — tenant isolation', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('LIST: returns 403 when caller targets an org they do not belong to', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(`/v1/organizations/${orgB.id}/stores/${storeB.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it('LIST: returns 404 when caller targets their own org but a storeId that lives in another org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await createOrder(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeB.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    // Existence non-disclosure — caller learns nothing about orgB.
    expect(res.status).toBe(404);
  });

  it("GET: returns 404 when caller targets a sibling org's storeId via their own org", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/orders/${orderB.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it("GET: returns 404 when caller targets their own org/store with a sibling org's orderId", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const orderB = await createOrder(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/orders/${orderB.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it('LIST: a member of two orgs only sees orders for the org they query', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    await createMembership(orgB.id, user.id);

    const storeA = await createStore(orgA.id);
    const storeB = await createStore(orgB.id);
    const orderA = await createOrder(orgA.id, storeA.id);
    await createOrder(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((o) => o.id)).toEqual([orderA.id]);
  });

  it('LIST: counts reflect only the queried org, never a sibling org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    await createOrder(orgA.id, storeA.id, { estimatedNetProfit: '10.00' });
    const excludedA = await createOrder(orgA.id, storeA.id);
    await prisma.order.update({
      where: { id: excludedA.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    for (let i = 0; i < 5; i += 1) {
      const excludedB = await createOrder(orgB.id, storeB.id);
      await prisma.order.update({
        where: { id: excludedB.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'LATE_UNCOSTED_ARRIVAL' },
      });
    }

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: { calculated: number; excluded: number } };
    expect(body.counts).toEqual({ calculated: 1, excluded: 1 });
  });
});
