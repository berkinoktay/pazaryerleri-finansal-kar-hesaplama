import type { MemberRole } from '@pazarsync/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../src/middleware/rate-limit.middleware';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const VALID_CREDS = {
  platform: 'TRENDYOL' as const,
  supplierId: '99999',
  apiKey: 'seed-trendyol-api-key',
  apiSecret: 'seed-trendyol-api-secret',
};

const CONNECT_BODY = {
  name: 'Role Gating Store',
  environment: 'PRODUCTION',
  credentials: VALID_CREDS,
};

function mockTrendyolProbe(res: Response): void {
  const realFetch = global.fetch.bind(global);
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('trendyol.com')) return res;
    return realFetch(input, init);
  });
}

describe('Store routes — role gating', () => {
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

  describe('POST /v1/organizations/:orgId/stores', () => {
    it.each<MemberRole>(['MEMBER', 'VIEWER'])(
      'returns 403 FORBIDDEN when caller has role %s',
      async (role) => {
        const user = await createAuthenticatedTestUser();
        const org = await createOrganization();
        await createMembership(org.id, user.id, role);
        mockTrendyolProbe(new Response('[]', { status: 200 }));

        const res = await app.request(`/v1/organizations/${org.id}/stores`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: bearer(user.accessToken),
          },
          body: JSON.stringify(CONNECT_BODY),
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe('FORBIDDEN');

        // Role-gated POST must not create the row even if the marketplace
        // probe was reachable — the guard runs before connect().
        const count = await prisma.store.count({ where: { organizationId: org.id } });
        expect(count).toBe(0);
      },
    );

    it.each<MemberRole>(['OWNER', 'ADMIN'])('returns 201 when caller has role %s', async (role) => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, role);
      mockTrendyolProbe(new Response('[]', { status: 200 }));

      const res = await app.request(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(user.accessToken),
        },
        body: JSON.stringify({ ...CONNECT_BODY, name: `${role} Store` }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /v1/organizations/:orgId/stores/:storeId', () => {
    it.each<MemberRole>(['MEMBER', 'VIEWER'])(
      'returns 403 FORBIDDEN when caller has role %s',
      async (role) => {
        const user = await createAuthenticatedTestUser();
        const org = await createOrganization();
        await createMembership(org.id, user.id, role);
        const store = await createStore(org.id);

        const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}`, {
          method: 'DELETE',
          headers: { Authorization: bearer(user.accessToken) },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe('FORBIDDEN');

        // The row must still exist — destructive op is gated.
        const after = await prisma.store.findUnique({ where: { id: store.id } });
        expect(after).not.toBeNull();
      },
    );

    it.each<MemberRole>(['OWNER', 'ADMIN'])('returns 204 when caller has role %s', async (role) => {
      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id, role);
      const store = await createStore(org.id);

      const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}`, {
        method: 'DELETE',
        headers: { Authorization: bearer(user.accessToken) },
      });

      expect(res.status).toBe(204);

      const after = await prisma.store.findUnique({ where: { id: store.id } });
      expect(after).toBeNull();
    });
  });
});
