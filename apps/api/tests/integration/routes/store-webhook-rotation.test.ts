import { prisma } from '@pazarsync/db';
import { decryptCredentials, encryptCredentials } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../src/middleware/rate-limit.middleware';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const TRENDYOL_BASE = 'https://stage.trendyol.test';
const PUBLIC_BASE = 'https://api.pazarsync.com';

function installTrendyolFetchMock(queue: Response[]): void {
  const real = global.fetch.bind(global);
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('trendyol')) {
      const next = queue.shift();
      if (next === undefined) throw new Error(`webhook queue empty for url: ${url}`);
      return next;
    }
    return real(input, init);
  });
}

const app = createApp();

async function createTrendyolStore(orgId: string) {
  return prisma.store.create({
    data: {
      organizationId: orgId,
      name: 'Rotate Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '99999',
      credentials: encryptCredentials({ supplierId: '99999', apiKey: 'k', apiSecret: 's' }),
      webhookId: 'trendyol-wh-rotation',
      webhookSecret: encryptCredentials({ username: 'old-u', password: 'old-p' }),
      webhookActiveAt: new Date('2026-01-01'),
    },
  });
}

describe('POST /v1/organizations/:orgId/stores/:storeId/webhook/rotate-secret', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    _resetRateLimitStoreForTests();
    await truncateAll();
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', TRENDYOL_BASE);
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', TRENDYOL_BASE);
    vi.stubEnv('TRENDYOL_INTEGRATOR_UA_SUFFIX', 'SelfIntegration');
    vi.stubEnv('PUBLIC_API_BASE_URL', PUBLIC_BASE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('401 without a bearer token', async () => {
    const org = await createOrganization();
    const store = await createTrendyolStore(org.id);
    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/webhook/rotate-secret`,
      { method: 'POST' },
    );
    expect(res.status).toBe(401);
  });

  it('403 when caller is MEMBER (not OWNER/ADMIN)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const store = await createTrendyolStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/webhook/rotate-secret`,
      {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(403);
  });

  it('200 + persists fresh encrypted credentials on success (OWNER)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createTrendyolStore(org.id);

    installTrendyolFetchMock([new Response(null, { status: 200 })]);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/webhook/rotate-secret`,
      {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rotatedAt: string };
    expect(body.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const row = await prisma.store.findFirstOrThrow({ where: { id: store.id } });
    const secret = decryptCredentials(row.webhookSecret!) as {
      username: string;
      password: string;
    };
    expect(secret.username).not.toBe('old-u');
    expect(secret.password).not.toBe('old-p');
  });

  it('422 STORE_CREDENTIALS_CORRUPTED when stored credentials decrypt to a non-Trendyol shape', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createTrendyolStore(org.id);
    // Decrypts cleanly, but is not a Trendyol credentials shape → user-fixable 422.
    await prisma.store.update({
      where: { id: store.id },
      data: { credentials: encryptCredentials({ not: 'trendyol' }) },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/webhook/rotate-secret`,
      { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors?: { code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.code).toBe('STORE_CREDENTIALS_CORRUPTED');
  });

  it('does NOT mask an undecryptable credentials blob as 422 (a decrypt failure keeps its 500 status, #266)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createTrendyolStore(org.id);
    // A blob that fails AES-GCM decryption (tampered / wrong key) is a server/
    // security fault, not user-fixable — it must surface as 500, never as a 422
    // "your credentials are corrupted" (the regression this guards against).
    await prisma.store.update({
      where: { id: store.id },
      data: { credentials: 'not-a-valid-encrypted-blob' },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/webhook/rotate-secret`,
      { method: 'POST', headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).not.toBe(422);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('404 when storeId does not exist in the calling org', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/00000000-0000-0000-0000-000000000000/webhook/rotate-secret`,
      {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(404);
  });

  it('404 (non-disclosure) when storeId belongs to another org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    const orgB = await createOrganization();
    await createMembership(orgA.id, user.id, 'OWNER');
    const otherStore = await createTrendyolStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${otherStore.id}/webhook/rotate-secret`,
      {
        method: 'POST',
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(404);
  });
});
