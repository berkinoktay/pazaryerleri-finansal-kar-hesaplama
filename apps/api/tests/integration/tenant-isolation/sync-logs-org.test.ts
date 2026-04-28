// Multi-tenancy isolation for the org-scoped sync-logs endpoint.
//
// Per docs/SECURITY.md §9 / CLAUDE.md memory: every org-scoped endpoint
// must have a dedicated isolation test in this directory. The pattern:
// create two orgs, write data in both, query as one user, assert the
// other org's data is invisible.

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

interface TenantSetup {
  user: { id: string; accessToken: string };
  orgId: string;
  storeId: string;
  syncLogId: string;
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
  const syncLog = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'PRODUCTS',
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });
  return {
    user: { id: user.id, accessToken: user.accessToken },
    orgId: org.id,
    storeId: store.id,
    syncLogId: syncLog.id,
  };
}

describe('Tenant isolation — GET /organizations/:orgId/sync-logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("user B does not see user A's active sync logs when listing under their own org", async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // User B reads under their own org — should see only their own RUNNING
    // log (the seeded one), never user A's.
    const res = await app.request(`/v1/organizations/${b.orgId}/sync-logs?active=true`, {
      headers: { Authorization: bearer(b.user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(b.syncLogId);
    // Sanity: A's log id is not in B's response.
    const ids = body.data.map((row) => row.id);
    expect(ids).not.toContain(a.syncLogId);
  });

  it("user A cross-tenant probe of user B's org returns 403 (not a member)", async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // A's token + B's orgId — org-membership gate trips.
    const res = await app.request(`/v1/organizations/${b.orgId}/sync-logs`, {
      headers: { Authorization: bearer(a.user.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it('does not include recent finished rows from other orgs even with the default (no `active=true`) query', async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    // Seed a COMPLETED row in org A so the default-mode listing for B
    // would surface it if the org filter were missing.
    await prisma.syncLog.create({
      data: {
        organizationId: a.orgId,
        storeId: a.storeId,
        syncType: 'PRODUCTS',
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(),
        recordsProcessed: 10,
      },
    });

    const res = await app.request(`/v1/organizations/${b.orgId}/sync-logs`, {
      headers: { Authorization: bearer(b.user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    // Only B's seeded RUNNING log is visible.
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(b.syncLogId);
  });
});
