import { prisma } from '@pazarsync/db';
import { decryptCredentials, encryptCredentials } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as storeService from '../../../src/services/store.service';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization } from '../../helpers/factories';

const TRENDYOL_BASE = 'https://stage.trendyol.test';
const PUBLIC_BASE = 'https://api.pazarsync.com';

const VALID_INPUT = {
  name: 'Lifecycle Test Store',
  environment: 'PRODUCTION' as const,
  credentials: {
    platform: 'TRENDYOL' as const,
    supplierId: '99999',
    apiKey: 'k',
    apiSecret: 's',
  },
};

const SANDBOX_INPUT = {
  ...VALID_INPUT,
  environment: 'SANDBOX' as const,
};

/**
 * Fetch interceptor: matches Trendyol probe + register/unregister/update URLs
 * by host. The probe (products endpoint) returns 200 OK with a paginated
 * shell. The webhook endpoints return whatever the caller queues via
 * `webhookFetchQueue` — push responses in expected call order.
 */
function installTrendyolFetchMock(queue: Response[]): void {
  const real = global.fetch.bind(global);
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('trendyol')) {
      // Probe endpoint: /integration/product/sellers/.../products
      if (url.includes('/integration/product/')) {
        return new Response(
          JSON.stringify({ content: [], totalElements: 0, totalPages: 1, page: 0, size: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Webhook endpoint: pop next queued response
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`webhook queue empty for url: ${url}`);
      }
      return next;
    }
    return real(input, init);
  });
}

function webhookCreateOk(id: string): Response {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function webhookOk(): Response {
  return new Response(null, { status: 200 });
}

function webhookErr(status = 500): Response {
  return new Response('upstream fail', { status });
}

describe('storeService — webhook lifecycle', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', TRENDYOL_BASE);
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', TRENDYOL_BASE);
    vi.stubEnv('TRENDYOL_INTEGRATOR_UA_SUFFIX', 'SelfIntegration');
    vi.stubEnv('ALLOW_SANDBOX_CONNECTIONS', 'true');
    vi.stubEnv('PUBLIC_API_BASE_URL', PUBLIC_BASE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('connect()', () => {
    it('TRENDYOL + PRODUCTION → registers webhook + persists webhookId/Secret/ActiveAt', async () => {
      const org = await createOrganization();
      installTrendyolFetchMock([webhookCreateOk('trendyol-wh-uuid-1')]);

      const result = await storeService.connect(org.id, VALID_INPUT);

      const row = await prisma.store.findFirstOrThrow({ where: { id: result.id } });
      expect(row.webhookId).toBe('trendyol-wh-uuid-1');
      expect(row.webhookSecret).not.toBeNull();
      expect(row.webhookActiveAt).not.toBeNull();

      // Encrypted blob is decryptable into the {username, password} shape
      const decrypted = decryptCredentials(row.webhookSecret!);
      expect(decrypted).toMatchObject({
        username: expect.stringMatching(/^pazarsync-[0-9a-f]{16}$/),
        password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
    });

    it('TRENDYOL + SANDBOX → registers webhook too (dev/ngrok HTTPS passes the callback check)', async () => {
      const org = await createOrganization();
      installTrendyolFetchMock([webhookCreateOk('trendyol-wh-sandbox-1')]);

      const result = await storeService.connect(org.id, SANDBOX_INPUT);

      const row = await prisma.store.findFirstOrThrow({ where: { id: result.id } });
      expect(row.webhookId).toBe('trendyol-wh-sandbox-1');
      expect(row.webhookSecret).not.toBeNull();
      expect(row.webhookActiveAt).not.toBeNull();
    });

    it('register failure is non-blocking; store IS created with webhook fields null', async () => {
      const org = await createOrganization();
      installTrendyolFetchMock([webhookErr(503)]);

      // Store creation must succeed despite register fail
      const result = await storeService.connect(org.id, VALID_INPUT);
      expect(result.id).toBeTypeOf('string');

      const row = await prisma.store.findFirstOrThrow({ where: { id: result.id } });
      expect(row.webhookId).toBeNull();
      expect(row.webhookSecret).toBeNull();
      expect(row.webhookActiveAt).toBeNull();
    });
  });

  describe('disconnect()', () => {
    it('TRENDYOL store with webhookId → calls Trendyol DELETE before local delete', async () => {
      const org = await createOrganization();
      const row = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Disconnect Test',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: '99999',
          credentials: encryptCredentials({
            supplierId: '99999',
            apiKey: 'k',
            apiSecret: 's',
          }),
          webhookId: 'trendyol-wh-uuid-disconnect',
          webhookSecret: encryptCredentials({
            username: 'u',
            password: 'p',
          }),
          webhookActiveAt: new Date(),
        },
      });

      installTrendyolFetchMock([webhookOk()]);

      await storeService.disconnect(org.id, row.id);

      // Local row gone
      expect(await prisma.store.findUnique({ where: { id: row.id } })).toBeNull();
    });

    it('TRENDYOL store without webhookId → skips Trendyol DELETE; still deletes locally', async () => {
      const org = await createOrganization();
      const row = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'No Webhook Store',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: '88888',
          credentials: encryptCredentials({
            supplierId: '88888',
            apiKey: 'k',
            apiSecret: 's',
          }),
          // webhookId null
        },
      });

      // No webhook fetch should fire
      installTrendyolFetchMock([]);

      await storeService.disconnect(org.id, row.id);
      expect(await prisma.store.findUnique({ where: { id: row.id } })).toBeNull();
    });

    it('Trendyol DELETE failure is non-blocking; local row still deleted', async () => {
      const org = await createOrganization();
      const row = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Disconnect Err Test',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: '77777',
          credentials: encryptCredentials({
            supplierId: '77777',
            apiKey: 'k',
            apiSecret: 's',
          }),
          webhookId: 'trendyol-wh-fail',
          webhookSecret: encryptCredentials({ username: 'u', password: 'p' }),
        },
      });
      installTrendyolFetchMock([webhookErr(500)]);

      await storeService.disconnect(org.id, row.id);
      expect(await prisma.store.findUnique({ where: { id: row.id } })).toBeNull();
    });
  });

  describe('rotateWebhookSecret()', () => {
    it('existing webhookId → calls Trendyol PUT and persists fresh credentials', async () => {
      const org = await createOrganization();
      const initial = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Rotate Test',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: '99999',
          credentials: encryptCredentials({
            supplierId: '99999',
            apiKey: 'k',
            apiSecret: 's',
          }),
          webhookId: 'trendyol-wh-rotation',
          webhookSecret: encryptCredentials({ username: 'old-u', password: 'old-p' }),
          webhookActiveAt: new Date('2026-01-01'),
        },
      });

      installTrendyolFetchMock([webhookOk()]);

      const result = await storeService.rotateWebhookSecret(org.id, initial.id);
      expect(result.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const row = await prisma.store.findFirstOrThrow({ where: { id: initial.id } });
      expect(row.webhookId).toBe('trendyol-wh-rotation'); // unchanged
      const newSecret = decryptCredentials(row.webhookSecret!) as {
        username: string;
        password: string;
      };
      expect(newSecret.username).not.toBe('old-u');
      expect(newSecret.password).not.toBe('old-p');
      expect(newSecret.username).toMatch(/^pazarsync-/);
    });

    it('webhookId null → falls through to register (first-time activation)', async () => {
      const org = await createOrganization();
      const initial = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Rotate First-Time',
          platform: 'TRENDYOL',
          environment: 'PRODUCTION',
          externalAccountId: '99999',
          credentials: encryptCredentials({
            supplierId: '99999',
            apiKey: 'k',
            apiSecret: 's',
          }),
          // webhookId null on purpose
        },
      });

      installTrendyolFetchMock([webhookCreateOk('first-time-wh-uuid')]);

      await storeService.rotateWebhookSecret(org.id, initial.id);

      const row = await prisma.store.findFirstOrThrow({ where: { id: initial.id } });
      expect(row.webhookId).toBe('first-time-wh-uuid');
      expect(row.webhookSecret).not.toBeNull();
      expect(row.webhookActiveAt).not.toBeNull();
    });

    it('404 when store is missing (cross-tenant non-disclosure)', async () => {
      const org = await createOrganization();
      await expect(
        storeService.rotateWebhookSecret(org.id, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(/Store/);
    });

    it('422 (ValidationError) when store is non-TRENDYOL', async () => {
      const org = await createOrganization();
      const row = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Hepsiburada Store',
          platform: 'HEPSIBURADA',
          environment: 'PRODUCTION',
          externalAccountId: '55555',
          credentials: 'irrelevant',
        },
      });

      await expect(storeService.rotateWebhookSecret(org.id, row.id)).rejects.toMatchObject({
        name: 'ValidationError',
        issues: [{ field: '(platform)', code: 'WEBHOOK_NOT_SUPPORTED_FOR_PLATFORM' }],
      });
    });
  });
});
