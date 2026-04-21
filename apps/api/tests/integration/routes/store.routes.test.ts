import { prisma } from '@pazarsync/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../src/middleware/rate-limit.middleware';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const VALID_CREDS = {
  platform: 'TRENDYOL' as const,
  supplierId: '99999',
  apiKey: 'seed-trendyol-api-key',
  apiSecret: 'seed-trendyol-api-secret',
};

const CONNECT_BODY = {
  name: 'Test Store',
  environment: 'PRODUCTION',
  credentials: VALID_CREDS,
};

/**
 * Mock the Trendyol probe ONLY. Passes non-Trendyol requests through to
 * the real fetch — crucial because authMiddleware uses fetch under the
 * hood (via supabase.auth.getUser) and we must not intercept that. A
 * global `mockResolvedValue(...)` clobbers Supabase's call and returns
 * an empty user object, which silently breaks auth.
 */
function mockProbe(res: Response): void {
  const realFetch = global.fetch.bind(global);
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('trendyol.com')) {
      return res;
    }
    return realFetch(input, init);
  });
}

describe('Store routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    _resetRateLimitStoreForTests();
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', 'https://apigw.trendyol.com');
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', 'https://stageapigw.trendyol.com');
    vi.stubEnv('TRENDYOL_INTEGRATOR_UA_SUFFIX', 'SelfIntegration');
    vi.stubEnv('ALLOW_SANDBOX_CONNECTIONS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('GET /v1/organizations/:orgId/stores', () => {
    it('returns 401 without a token', async () => {
      const org = await createOrganization();
      const res = await app.request(`/v1/organizations/${org.id}/stores`);
      expect(res.status).toBe(401);
    });

    it('returns 403 when the user is not a member of the org', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(403);
    });

    it('returns an empty list for an org with no stores', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });
  });

  describe('POST /v1/organizations/:orgId/stores (happy path)', () => {
    it('validates credentials with the vendor, encrypts, and returns the store', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response('[]', { status: 200 }));

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify(CONNECT_BODY),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.platform).toBe('TRENDYOL');
      expect(body.environment).toBe('PRODUCTION');
      expect(body.externalAccountId).toBe('99999');
      expect(body.status).toBe('ACTIVE');
      // NEVER return credentials.
      expect('credentials' in body).toBe(false);
      const raw = JSON.stringify(body);
      expect(raw).not.toMatch(/apiKey|apiSecret|credentials/i);

      // DB row has encrypted credentials (not plaintext JSON).
      const row = await prisma.store.findFirstOrThrow({
        where: { organizationId: org.id },
      });
      expect(typeof row.credentials).toBe('string');
      expect(String(row.credentials)).not.toContain('seed-trendyol-api-key');
    });
  });

  describe('POST — sandbox gate (D4)', () => {
    it('rejects SANDBOX when ALLOW_SANDBOX_CONNECTIONS is not "true"', async () => {
      vi.stubEnv('ALLOW_SANDBOX_CONNECTIONS', 'false');

      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({ ...CONNECT_BODY, environment: 'SANDBOX' }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; errors: Array<{ code: string }> };
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors.map((e) => e.code)).toContain('SANDBOX_NOT_ALLOWED');
    });

    it('accepts SANDBOX when ALLOW_SANDBOX_CONNECTIONS is "true"', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response('[]', { status: 200 }));

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({ ...CONNECT_BODY, environment: 'SANDBOX' }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('POST — validation + error paths', () => {
    it('returns 422 VALIDATION_ERROR on missing/short name', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({ ...CONNECT_BODY, name: 'A' }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { errors: Array<{ code: string }> };
      expect(body.errors.map((e) => e.code)).toContain('INVALID_NAME_TOO_SHORT');
    });

    it('rejects platform: HEPSIBURADA at the Zod layer', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({
          name: 'HB Store',
          environment: 'PRODUCTION',
          credentials: {
            platform: 'HEPSIBURADA',
            merchantId: 'm1',
            apiKey: 'xxxxxxxx',
            apiSecret: 'xxxxxxxx',
          },
        }),
      });
      expect(res.status).toBe(422);
    });

    it('returns 422 MARKETPLACE_AUTH_FAILED when Trendyol rejects creds', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response(null, { status: 401 }));

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify(CONNECT_BODY),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('MARKETPLACE_AUTH_FAILED');

      // Probe failed → no DB row was created.
      const count = await prisma.store.count({ where: { organizationId: org.id } });
      expect(count).toBe(0);
    });

    it('returns 409 CONFLICT on duplicate connection (same supplierId)', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response('[]', { status: 200 }));

      // First connect succeeds.
      const first = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify(CONNECT_BODY),
      });
      expect(first.status).toBe(201);

      // Second connect with the same supplierId → 409.
      const second = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({ ...CONNECT_BODY, name: 'Another Name' }),
      });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { code: string };
      expect(body.code).toBe('CONFLICT');
    });

    it('rate-limits after 5 POSTs per minute with 429 + Retry-After', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response(null, { status: 401 })); // all attempts fail auth

      const fire = () =>
        app.request(`/v1/organizations/${org.id}/stores`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: bearer(user.accessToken),
          },
          body: JSON.stringify(CONNECT_BODY),
        });

      for (let i = 0; i < 5; i++) {
        const res = await fire();
        expect(res.status).toBe(422);
      }
      const limited = await fire();
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    });
  });

  describe('GET + DELETE by id', () => {
    it('GET returns the store when it belongs to the org', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response('[]', { status: 200 }));
      const created = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify(CONNECT_BODY),
      });
      const createdBody = (await created.json()) as { id: string };

      const res = await app.request(`/v1/organizations/${org.id}/stores/${createdBody.id}`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(res.status).toBe(200);
    });

    it('GET returns 404 for a non-existent storeId', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');

      const res = await app.request(
        `/v1/organizations/${org.id}/stores/00000000-0000-0000-0000-000000000000`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(404);
    });

    it('DELETE returns 204 and a follow-up GET returns 404', async () => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');
      mockProbe(new Response('[]', { status: 200 }));
      const created = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify(CONNECT_BODY),
      });
      const { id } = (await created.json()) as { id: string };

      const del = await app.request(`/v1/organizations/${org.id}/stores/${id}`, {
        method: 'DELETE',
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(del.status).toBe(204);

      const get = await app.request(`/v1/organizations/${org.id}/stores/${id}`, {
        headers: { Authorization: bearer(user.accessToken) },
      });
      expect(get.status).toBe(404);
    });
  });
});
