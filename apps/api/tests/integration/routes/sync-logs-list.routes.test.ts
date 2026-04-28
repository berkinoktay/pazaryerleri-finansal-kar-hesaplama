import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

async function setupOrgWithStore(): Promise<{
  user: { accessToken: string };
  orgId: string;
  storeId: string;
}> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '2738',
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'k',
        apiSecret: 's',
      }),
    },
  });
  return { user: { accessToken: user.accessToken }, orgId: org.id, storeId: store.id };
}

describe('GET /v1/organizations/:orgId/stores/:storeId/sync-logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without an auth token', async () => {
    const { orgId, storeId } = await setupOrgWithStore();
    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/sync-logs`);
    expect(res.status).toBe(401);
  });

  it('returns empty data when no sync logs exist', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/sync-logs`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns RUNNING rows first then up to 5 most-recent COMPLETED/FAILED', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();

    // 1 RUNNING + 6 finished (5 COMPLETED, 1 FAILED) — should return
    // 1 RUNNING + 5 most-recent finished, sorted newest-first.
    const now = Date.now();
    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(now - 30 * 1000),
        progressCurrent: 100,
        progressTotal: 500,
      },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.syncLog.create({
        data: {
          organizationId: orgId,
          storeId,
          syncType: 'PRODUCTS',
          status: 'COMPLETED',
          startedAt: new Date(now - (i + 2) * 60 * 60 * 1000),
          completedAt: new Date(now - (i + 2) * 60 * 60 * 1000 + 30_000),
          recordsProcessed: 500,
        },
      });
    }
    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'FAILED',
        startedAt: new Date(now - 24 * 60 * 60 * 1000), // oldest, should be cut off
        completedAt: new Date(now - 24 * 60 * 60 * 1000 + 1_000),
        errorCode: 'MARKETPLACE_AUTH_FAILED',
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/sync-logs`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ status: string; startedAt: string }>;
    };

    expect(body.data).toHaveLength(6); // 1 active + 5 recent
    expect(body.data[0]?.status).toBe('RUNNING');
    // The 5 finished rows that come after must all be COMPLETED (the
    // older FAILED is past the limit).
    for (const log of body.data.slice(1)) {
      expect(log.status).toBe('COMPLETED');
    }
    // Recent rows are sorted newest first.
    const recentTimestamps = body.data.slice(1).map((l) => Date.parse(l.startedAt));
    for (let i = 1; i < recentTimestamps.length; i++) {
      expect(recentTimestamps[i - 1]).toBeGreaterThan(recentTimestamps[i]!);
    }
  });

  it('returns 404 when storeId belongs to a different org (no existence disclosure)', async () => {
    const { user, orgId } = await setupOrgWithStore();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '999',
        credentials: 'opaque',
      },
    });
    await prisma.syncLog.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStore.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/stores/${otherStore.id}/sync-logs`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(404);
  });

  it('does not leak sync logs from a different org listed under the same path', async () => {
    const { user: userA, orgId: orgAId, storeId: storeAId } = await setupOrgWithStore();
    const orgB = await createOrganization();
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '888',
        credentials: 'opaque',
      },
    });
    // Org B has a RUNNING log; org A has none. Org A's user must see [].
    await prisma.syncLog.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    const res = await app.request(`/v1/organizations/${orgAId}/stores/${storeAId}/sync-logs`, {
      headers: { Authorization: bearer(userA.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe('GET /v1/organizations/:orgId/sync-logs (org-scoped)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns active + recent syncs across every store in the org', async () => {
    const { user, orgId, storeId: storeAId } = await setupOrgWithStore();
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgId,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'xb',
        credentials: 'opaque',
      },
    });

    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId: storeAId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId: storeB.id,
        syncType: 'ORDERS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/sync-logs?active=true`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ storeId: string; status: string }> };
    expect(body.data).toHaveLength(2);
    for (const log of body.data) {
      expect(log.status).toBe('RUNNING');
    }
    const returnedStoreIds = body.data.map((log) => log.storeId).sort();
    expect(returnedStoreIds).toEqual([storeAId, storeB.id].sort());
  });

  it('does not leak syncs from a different org', async () => {
    const { user, orgId } = await setupOrgWithStore();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'xx',
        credentials: 'opaque',
      },
    });
    await prisma.syncLog.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStore.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/sync-logs?active=true`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
