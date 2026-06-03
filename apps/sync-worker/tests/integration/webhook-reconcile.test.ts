import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { processWebhookReconcile } from '../../src/handlers/webhook-reconcile';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { createOrganization, createStore } from '../../../../apps/api/tests/helpers/factories';

const SUPPLIER_ID = '2738';
const TRENDYOL_BASE = 'https://stage.trendyol.test';
const PUBLIC_BASE = 'https://x.ngrok-free.dev';
const FAKE_ENCRYPTION_KEY = 'deadbeef'.repeat(8); // 64 hex chars

const ENV_KEYS = ['TRENDYOL_PROD_BASE_URL', 'PUBLIC_API_BASE_URL', 'ENCRYPTION_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

interface RecordedCall {
  url: string;
  method: string;
}

/**
 * Routing fetch mock standing in for Trendyol's webhook API:
 *   GET    .../webhooks          → the seeded subscription list
 *   POST   .../webhooks          → mints a new `{ id }`
 *   PUT    .../webhooks/{id}      → 200 (rotate)
 *   DELETE .../webhooks/{id}      → 200 (prune)
 * Records every call so a test can assert which register/prune actions fired.
 */
function installTrendyolWebhookMock(remoteList: Array<{ id: string; url: string }>): {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let registerSeq = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    if (method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(remoteList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (method === 'POST') {
      registerSeq += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ id: `new-wh-${registerSeq}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  return { calls };
}

async function seedTrendyolStore(
  organizationId: string,
  over: { webhookId?: string | null; webhookSecret?: string | null } = {},
): Promise<{ id: string }> {
  const store = await createStore(organizationId, { externalAccountId: SUPPLIER_ID });
  return prisma.store.update({
    where: { id: store.id },
    data: {
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
      ...over,
    },
    select: { id: true },
  });
}

describe('processWebhookReconcile', () => {
  beforeAll(async () => {
    await ensureDbReachable();
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  beforeEach(async () => {
    await truncateAll();
    process.env['TRENDYOL_PROD_BASE_URL'] = TRENDYOL_BASE;
    process.env['PUBLIC_API_BASE_URL'] = PUBLIC_BASE;
    process.env['ENCRYPTION_KEY'] = FAKE_ENCRYPTION_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('registers a store with no webhook and prunes an orphan under our base', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, { webhookId: null, webhookSecret: null });
    const { calls } = installTrendyolWebhookMock([
      { id: 'orphan-wh', url: `${PUBLIC_BASE}/v1/webhooks/orders/dead-store` },
    ]);

    await processWebhookReconcile();

    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('new-wh-1');
    expect(row.webhookSecret).not.toBeNull();
    expect(row.webhookActiveAt).not.toBeNull();

    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/webhooks/orphan-wh'))).toBe(
      true,
    );
  });

  it('leaves a healthy store untouched (only the per-seller GET fires)', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, {
      webhookId: 'wh-existing',
      webhookSecret: encryptCredentials({ username: 'u', password: 'p' }),
    });
    const { calls } = installTrendyolWebhookMock([
      { id: 'wh-existing', url: `${PUBLIC_BASE}/v1/webhooks/orders/${store.id}` },
    ]);

    await processWebhookReconcile();

    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('wh-existing');
  });

  it('re-registers (update) a store whose remote hook exists but local secret is null', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, {
      webhookId: 'wh-existing',
      webhookSecret: null,
    });
    const { calls } = installTrendyolWebhookMock([
      { id: 'wh-existing', url: `${PUBLIC_BASE}/v1/webhooks/orders/${store.id}` },
    ]);

    await processWebhookReconcile();

    // PUT update at the existing webhook id; no new POST register.
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/webhooks/wh-existing'))).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('wh-existing');
    expect(row.webhookSecret).not.toBeNull();
  });

  it('skips entirely (no Trendyol calls) when PUBLIC_API_BASE_URL is unset', async () => {
    process.env['PUBLIC_API_BASE_URL'] = '';
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, { webhookId: null, webhookSecret: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await processWebhookReconcile();

    expect(fetchSpy).not.toHaveBeenCalled();
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBeNull();
  });
});
