import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

async function setupOrgWithStore(): Promise<{
  user: { id: string; email: string; accessToken: string };
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
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });
  return { user, orgId: org.id, storeId: store.id };
}

describe('POST /v1/organizations/:orgId/stores/:storeId/products/sync', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without an auth token', async () => {
    const org = await createOrganization();
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '999',
        credentials: 'opaque',
      },
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/products/sync`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is not a member of the organization', async () => {
    const { user } = await setupOrgWithStore();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '888',
        credentials: 'opaque',
      },
    });

    const res = await app.request(
      `/v1/organizations/${otherOrg.id}/stores/${otherStore.id}/products/sync`,
      { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the storeId belongs to a different org (no existence disclosure)', async () => {
    const { user, orgId } = await setupOrgWithStore();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other Org Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '777',
        credentials: 'opaque',
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${otherStore.id}/products/sync`,
      { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 202 with syncLogId for a valid request and inserts a PENDING SyncLog row', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products/sync`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      syncLogId: string;
      status: string;
      enqueuedAt: string;
    };
    expect(body.status).toBe('PENDING');
    expect(body.syncLogId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.enqueuedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const logRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: body.syncLogId } });
    expect(logRow.storeId).toBe(storeId);
    expect(logRow.syncType).toBe('PRODUCTS');
    expect(logRow.status).toBe('PENDING');
  });

  it('returns 409 SYNC_IN_PROGRESS with existingSyncLogId when an active sync exists', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    // Pre-seed a PENDING SyncLog — the partial unique index treats
    // PENDING / RUNNING / FAILED_RETRYABLE all as "active slot taken".
    const existing = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products/sync`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; meta?: Record<string, unknown> };
    expect(body.code).toBe('SYNC_IN_PROGRESS');
    expect(body.meta?.['syncType']).toBe('PRODUCTS');
    expect(body.meta?.['storeId']).toBe(storeId);
    expect(body.meta?.['existingSyncLogId']).toBe(existing.id);
  });
});

describe('GET /v1/organizations/:orgId/stores/:storeId/sync-logs/:syncLogId', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the sync-log row with progress fields for an authorized user', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    const log = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        progressCurrent: 50,
        progressTotal: 200,
        progressStage: 'upserting',
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/sync-logs/${log.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      progressCurrent: number;
      progressTotal: number | null;
      progressStage: string | null;
    };
    expect(body.id).toBe(log.id);
    expect(body.status).toBe('RUNNING');
    expect(body.progressCurrent).toBe(50);
    expect(body.progressTotal).toBe(200);
    expect(body.progressStage).toBe('upserting');
  });

  it('returns 404 when the sync log belongs to another org (no disclosure)', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '666',
        credentials: 'opaque',
      },
    });
    const otherLog = await prisma.syncLog.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStore.id,
        syncType: 'PRODUCTS',
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    // Try to read otherOrg's sync log via our orgId path — the store gate
    // should 404 first since otherStore.id is not under our org.
    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${otherStore.id}/sync-logs/${otherLog.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);

    // And via the legitimate storeId, the syncLogId from another store still 404s.
    const res2 = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/sync-logs/${otherLog.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res2.status).toBe(404);
  });
});
