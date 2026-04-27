import { prisma } from '@pazarsync/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@/lib/crypto';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyPage(): Response {
  return jsonResponse({
    totalElements: 0,
    totalPages: 0,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: [],
  });
}

/**
 * Replace `fetch` for Trendyol URLs only — Supabase auth verification
 * also goes through `globalThis.fetch`, and a blanket mock would cause
 * the auth middleware to reject every Bearer token.
 */
function mockTrendyolFetch(response: () => Response): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('trendyol')) {
      return response();
    }
    return realFetch(input as RequestInfo, init);
  });
}

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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('returns 202 with syncLogId for a valid request and inserts a RUNNING SyncLog row', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    // Stub Trendyol response so the background sync completes promptly,
    // but let the Supabase auth call pass through (auth middleware uses
    // the same globalThis.fetch).
    mockTrendyolFetch(emptyPage);

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products/sync`, {
      method: 'POST',
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      syncLogId: string;
      status: string;
      startedAt: string;
    };
    expect(body.status).toBe('RUNNING');
    expect(body.syncLogId).toMatch(/^[0-9a-f-]{36}$/);

    const logRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: body.syncLogId } });
    expect(logRow.storeId).toBe(storeId);
    expect(logRow.syncType).toBe('PRODUCTS');
  });

  it('returns 409 SYNC_IN_PROGRESS when a sync is already RUNNING for the store', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    // Pre-seed a RUNNING SyncLog newer than the 10-minute reap threshold.
    await prisma.syncLog.create({
      data: {
        storeId,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
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
