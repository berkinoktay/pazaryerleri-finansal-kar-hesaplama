import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

// The four merchant-triggerable sync types (PRODUCTS_DELTA is cron-internal
// and deliberately excluded from the trigger body enum).
const TRIGGERABLE_SYNC_TYPES = ['ORDERS', 'PRODUCTS', 'SETTLEMENTS', 'CLAIMS'] as const;

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

describe('POST /v1/organizations/:orgId/stores/:storeId/syncs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without an auth token', async () => {
    const { orgId, storeId } = await setupOrgWithStore();
    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncType: 'ORDERS' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for a VIEWER with store access and enqueues nothing', async () => {
    // A VIEWER is granted access to the store (so requireStoreAccess passes) but
    // its role lacks SYNC_TRIGGER (see ROLE_CAPABILITIES in @pazarsync/utils), so
    // assertCapability trips with 403 before triggerManualSync runs.
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, owner.id, 'OWNER');
    const store = await createStore(org.id);

    const viewer = await createAuthenticatedTestUser();
    const membership = await createMembership(org.id, viewer.id, 'VIEWER');
    await createMemberStoreAccess(org.id, membership.id, store.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(viewer.accessToken) },
      body: JSON.stringify({ syncType: 'ORDERS' }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');

    // The capability gate short-circuits before acquireSlot — no SyncLog row.
    expect(await prisma.syncLog.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('returns 202 with a PENDING MANUAL SyncLog row for a valid request', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(user.accessToken) },
      body: JSON.stringify({ syncType: 'ORDERS' }),
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
    expect(logRow.syncType).toBe('ORDERS');
    expect(logRow.status).toBe('PENDING');
    // Same MANUAL stamp as the products/sync route so the cooldown check finds it.
    expect(logRow.triggerSource).toBe('MANUAL');
  });

  it.each(TRIGGERABLE_SYNC_TYPES)('accepts syncType %s with a 202', async (syncType) => {
    const { user, orgId, storeId } = await setupOrgWithStore();

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(user.accessToken) },
      body: JSON.stringify({ syncType }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { syncLogId: string; status: string };
    expect(body.status).toBe('PENDING');
    const logRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: body.syncLogId } });
    expect(logRow.syncType).toBe(syncType);
    expect(logRow.triggerSource).toBe('MANUAL');
  });

  it('rejects PRODUCTS_DELTA in the body with 422 VALIDATION_ERROR (INVALID_SYNC_TYPE)', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(user.accessToken) },
      body: JSON.stringify({ syncType: 'PRODUCTS_DELTA' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      errors: Array<{ field: string; code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.field === 'syncType' && e.code === 'INVALID_SYNC_TYPE')).toBe(
      true,
    );

    // No sync log was enqueued.
    expect(await prisma.syncLog.count({ where: { storeId } })).toBe(0);
  });

  it('returns 409 SYNC_IN_PROGRESS with existingSyncLogId when an active slot exists', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    // Pre-seed a PENDING ORDERS row — the partial unique index treats
    // PENDING / RUNNING / FAILED_RETRYABLE as "active slot taken".
    const existing = await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'ORDERS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(user.accessToken) },
      body: JSON.stringify({ syncType: 'ORDERS' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; meta?: Record<string, unknown> };
    expect(body.code).toBe('SYNC_IN_PROGRESS');
    expect(body.meta?.['syncType']).toBe('ORDERS');
    expect(body.meta?.['storeId']).toBe(storeId);
    expect(body.meta?.['existingSyncLogId']).toBe(existing.id);
  });

  it('returns 429 RATE_LIMITED with Retry-After when a MANUAL sync ran inside the cooldown window', async () => {
    const { user, orgId, storeId } = await setupOrgWithStore();
    // A completed MANUAL ORDERS sync one minute ago — still inside the 5-minute
    // ORDERS cooldown window.
    await prisma.syncLog.create({
      data: {
        organizationId: orgId,
        storeId,
        syncType: 'ORDERS',
        status: 'COMPLETED',
        triggerSource: 'MANUAL',
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(Date.now() - 30_000),
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/syncs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(user.accessToken) },
      body: JSON.stringify({ syncType: 'ORDERS' }),
    });

    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(5 * 60);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('RATE_LIMITED');

    // The cooldown short-circuits BEFORE acquireSlot — no new slot row.
    const active = await prisma.syncLog.count({
      where: { storeId, status: { in: ['PENDING', 'RUNNING'] } },
    });
    expect(active).toBe(0);
  });
});
