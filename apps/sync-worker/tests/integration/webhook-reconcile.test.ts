import { prisma } from '@pazarsync/db';
import { decryptCredentials, encryptCredentials, syncLog } from '@pazarsync/sync-core';
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

const urlFor = (storeId: string): string => `${PUBLIC_BASE}/v1/webhooks/orders/${storeId}`;

interface RecordedCall {
  url: string;
  method: string;
  supplierId: string | undefined;
}

interface SellerMock {
  supplierId: string;
  /** Subscriptions the GET returns for this seller. */
  remote?: Array<{ id: string; url: string; status?: string }>;
  /** When true, this seller's GET returns 500 (simulates a Trendyol outage). */
  failGet?: boolean;
}

/**
 * Routing fetch mock standing in for Trendyol's webhook API, keyed by the
 * supplierId embedded in `/sellers/{supplierId}/webhooks`:
 *   GET    → that seller's `remote` list (or 500 if `failGet`)
 *   POST   → mints a new `{ id }`
 *   PUT/DELETE → 200
 * Records every call (url+method+supplierId) so a test can assert per-seller
 * behaviour and action ordering.
 */
function installTrendyolWebhookMock(sellers: SellerMock[]): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const bySupplier = new Map(sellers.map((s) => [s.supplierId, s]));
  let registerSeq = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const supplierId = /\/sellers\/([^/]+)\/webhooks/.exec(url)?.[1];
    calls.push({ url, method, supplierId });
    const cfg = supplierId === undefined ? undefined : bySupplier.get(supplierId);
    if (method === 'GET') {
      if (cfg?.failGet === true)
        return Promise.resolve(new Response('upstream fail', { status: 500 }));
      return Promise.resolve(
        new Response(JSON.stringify(cfg?.remote ?? []), {
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
  supplierId: string,
  over: { webhookId?: string | null; webhookSecret?: string | null } = {},
): Promise<{ id: string }> {
  const store = await createStore(organizationId, { externalAccountId: supplierId });
  return prisma.store.update({
    where: { id: store.id },
    data: {
      credentials: encryptCredentials({ supplierId, apiKey: 'k', apiSecret: 's' }),
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

  it('registers a store with no webhook and prunes an orphan — pruning BEFORE registering', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
    });
    const { calls } = installTrendyolWebhookMock([
      {
        supplierId: SUPPLIER_ID,
        remote: [{ id: 'orphan-wh', url: urlFor('dead-store'), status: 'ACTIVE' }],
      },
    ]);

    await processWebhookReconcile();

    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('new-wh-1');
    expect(row.webhookSecret).not.toBeNull();
    expect(row.webhookActiveAt).not.toBeNull();

    const deleteIdx = calls.findIndex(
      (c) => c.method === 'DELETE' && c.url.endsWith('/webhooks/orphan-wh'),
    );
    const postIdx = calls.findIndex((c) => c.method === 'POST');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(postIdx).toBeGreaterThanOrEqual(0);
    // Cap-safety: the orphan slot is freed before the new subscription is created.
    expect(deleteIdx).toBeLessThan(postIdx);
  });

  it('leaves a healthy store untouched (only the per-seller GET fires)', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, SUPPLIER_ID, {
      webhookId: 'wh-existing',
      webhookSecret: encryptCredentials({ username: 'u', password: 'p' }),
    });
    const { calls } = installTrendyolWebhookMock([
      {
        supplierId: SUPPLIER_ID,
        remote: [{ id: 'wh-existing', url: urlFor(store.id), status: 'ACTIVE' }],
      },
    ]);

    await processWebhookReconcile();

    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('wh-existing');
  });

  it('updates (PUT) a store whose remote hook exists but local secret is null, stamping a fresh secret', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, SUPPLIER_ID, {
      webhookId: 'wh-existing',
      webhookSecret: null,
    });
    const { calls } = installTrendyolWebhookMock([
      {
        supplierId: SUPPLIER_ID,
        remote: [{ id: 'wh-existing', url: urlFor(store.id), status: 'ACTIVE' }],
      },
    ]);

    await processWebhookReconcile();

    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/webhooks/wh-existing'))).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('wh-existing');
    expect(row.webhookActiveAt).not.toBeNull();
    expect(decryptCredentials(row.webhookSecret ?? '')).toMatchObject({
      username: expect.stringMatching(/^pazarsync-/),
      password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it('heals a PASSIVE remote hook: prunes it then re-registers a fresh ACTIVE subscription', async () => {
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, SUPPLIER_ID, {
      webhookId: 'wh-passive',
      webhookSecret: encryptCredentials({ username: 'u', password: 'p' }),
    });
    const { calls } = installTrendyolWebhookMock([
      {
        supplierId: SUPPLIER_ID,
        remote: [{ id: 'wh-passive', url: urlFor(store.id), status: 'PASSIVE' }],
      },
    ]);

    await processWebhookReconcile();

    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/webhooks/wh-passive'))).toBe(
      true,
    );
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBe('new-wh-1'); // re-registered, no longer the dead PASSIVE id
  });

  it('groups stores of the same seller (two orgs, one supplier) into a single GET + one register each', async () => {
    const orgA = await createOrganization();
    const orgB = await createOrganization();
    const storeA = await seedTrendyolStore(orgA.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
    });
    const storeB = await seedTrendyolStore(orgB.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
    });
    const { calls } = installTrendyolWebhookMock([{ supplierId: SUPPLIER_ID, remote: [] }]);

    await processWebhookReconcile();

    // One GET for the shared seller, one register per store — never one GET per store.
    expect(calls.filter((c) => c.method === 'GET').length).toBe(1);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(2);
    const rowA = await prisma.store.findUniqueOrThrow({ where: { id: storeA.id } });
    const rowB = await prisma.store.findUniqueOrThrow({ where: { id: storeB.id } });
    expect(rowA.webhookId).not.toBeNull();
    expect(rowB.webhookId).not.toBeNull();
    expect(rowA.webhookId).not.toBe(rowB.webhookId);
  });

  it('issues one GET per distinct seller', async () => {
    const org = await createOrganization();
    await seedTrendyolStore(org.id, 'AAA', { webhookId: null, webhookSecret: null });
    await seedTrendyolStore(org.id, 'BBB', { webhookId: null, webhookSecret: null });
    const { calls } = installTrendyolWebhookMock([
      { supplierId: 'AAA', remote: [] },
      { supplierId: 'BBB', remote: [] },
    ]);

    await processWebhookReconcile();

    const getSuppliers = calls
      .filter((c) => c.method === 'GET')
      .map((c) => c.supplierId)
      .sort();
    expect(getSuppliers).toEqual(['AAA', 'BBB']);
  });

  it('isolates a failing seller: a Trendyol error for seller A does not block seller B', async () => {
    const org = await createOrganization();
    const storeA = await seedTrendyolStore(org.id, 'AAA', { webhookId: null, webhookSecret: null });
    const storeB = await seedTrendyolStore(org.id, 'BBB', { webhookId: null, webhookSecret: null });
    installTrendyolWebhookMock([
      { supplierId: 'AAA', failGet: true },
      { supplierId: 'BBB', remote: [] },
    ]);
    const errorSpy = vi.spyOn(syncLog, 'error');

    await expect(processWebhookReconcile()).resolves.toBeUndefined();

    const rowA = await prisma.store.findUniqueOrThrow({ where: { id: storeA.id } });
    const rowB = await prisma.store.findUniqueOrThrow({ where: { id: storeB.id } });
    expect(rowA.webhookId).toBeNull(); // A failed, untouched
    expect(rowB.webhookId).not.toBeNull(); // B still healed
    expect(errorSpy).toHaveBeenCalledWith(
      'webhook.reconcile-seller-error',
      expect.objectContaining({ sellerId: 'AAA' }),
    );
  });

  it('skips entirely (no Trendyol calls) when PUBLIC_API_BASE_URL is unset', async () => {
    process.env['PUBLIC_API_BASE_URL'] = '';
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await processWebhookReconcile();

    expect(fetchSpy).not.toHaveBeenCalled();
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).toBeNull();
  });
});
