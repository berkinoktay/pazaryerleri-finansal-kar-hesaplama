// Multi-tenancy isolation for the generic manual-sync trigger.
//
// Per docs/SECURITY.md §9: every org-scoped endpoint must have an
// isolation test in this directory. Mirrors the products-sync isolation
// pattern: create two orgs, attempt to trigger a sync across the boundary,
// assert the other org's store is invisible (404, never 200/enqueue) and
// no SyncLog row leaks in.

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

interface TenantSetup {
  user: { id: string; email: string; accessToken: string };
  orgId: string;
  storeId: string;
}

async function makeTenant(): Promise<TenantSetup> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Tenant Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: `seller-${Math.random().toString(36).slice(2, 8)}`,
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });
  // A pre-existing COMPLETED log so the "no new row" assertions can prove a
  // trigger did NOT enqueue anything (count stays at the seeded baseline).
  await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'PRODUCTS',
      status: 'COMPLETED',
      startedAt: new Date(),
      completedAt: new Date(),
      recordsProcessed: 5,
      progressCurrent: 5,
      progressTotal: 5,
    },
  });
  return { user, orgId: org.id, storeId: store.id };
}

describe('Tenant isolation — POST /organizations/:orgId/stores/:storeId/syncs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("user A cannot trigger a sync against user B's store (404, not 403)", async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // Path: orgA + storeB. The org-membership gate passes (A is a member of
    // orgA), but the store-ownership gate trips because storeB is not under
    // orgA. Result is 404 with no existence disclosure. A valid body is sent
    // so validation clears and the store gate is what trips.
    const res = await app.request(`/v1/organizations/${a.orgId}/stores/${b.storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(a.user.accessToken) },
      body: JSON.stringify({ syncType: 'ORDERS' }),
    });
    expect(res.status).toBe(404);

    // No SyncLog row was inserted under B's store (only the seeded one).
    expect(await prisma.syncLog.count({ where: { storeId: b.storeId } })).toBe(1);
    expect(await prisma.syncLog.count({ where: { storeId: b.storeId, syncType: 'ORDERS' } })).toBe(
      0,
    );
  });

  it("user A cannot trigger a sync under user B's org (403, not a member)", async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // A's token + B's orgId + B's storeId — the org-membership gate trips
    // before the store lookup or the sync enqueue.
    const res = await app.request(`/v1/organizations/${b.orgId}/stores/${b.storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(a.user.accessToken) },
      body: JSON.stringify({ syncType: 'ORDERS' }),
    });
    expect(res.status).toBe(403);

    // Still no ORDERS row under B's store.
    expect(await prisma.syncLog.count({ where: { storeId: b.storeId, syncType: 'ORDERS' } })).toBe(
      0,
    );
  });
});
