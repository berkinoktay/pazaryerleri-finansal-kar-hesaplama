import { prisma } from '@pazarsync/db';
import type { StoreEnvironment } from '@pazarsync/db';
import { decryptCredentials, encryptCredentials, syncLog } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { processWebhookReconcile } from '../../src/handlers/webhook-reconcile';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { createOrganization, createStore } from '../../../../apps/api/tests/helpers/factories';

const SUPPLIER_ID = '2738';
const TRENDYOL_BASE = 'https://stage.trendyol.test';
const TRENDYOL_SANDBOX_BASE = 'https://sandbox.trendyol.test';
const PUBLIC_BASE = 'https://x.ngrok-free.dev';
const FAKE_ENCRYPTION_KEY = 'deadbeef'.repeat(8); // 64 hex chars
// Matches the handler's WEBHOOK_SELLER_CAP_WARN_AT threshold (13, cap 15).
const WEBHOOK_NEAR_CAP_COUNT = 13;

const ENV_KEYS = [
  'TRENDYOL_PROD_BASE_URL',
  'TRENDYOL_SANDBOX_BASE_URL',
  'PUBLIC_API_BASE_URL',
  'WEBHOOK_PRUNE_EXTRA_BASE_URLS',
  'ENCRYPTION_KEY',
] as const;
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
  /**
   * Fail the FIRST N GET calls to this seller (500), then succeed — models the
   * credential-fallback loop trying store A's dead credential (GET fails) then
   * store B's live one (GET succeeds) for a shared seller.
   */
  failGetTimes?: number;
  /**
   * Make the DELETE for this webhookId return 500 — models a ghost/double-delete
   * prune failure that must not abort the seller group's registers.
   */
  failDeleteWebhookId?: string;
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
  const getCounts = new Map<string, number>();
  let registerSeq = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const supplierId = /\/sellers\/([^/]+)\/webhooks/.exec(url)?.[1];
    calls.push({ url, method, supplierId });
    const cfg = supplierId === undefined ? undefined : bySupplier.get(supplierId);
    if (method === 'GET') {
      const key = supplierId ?? '';
      const seen = getCounts.get(key) ?? 0;
      getCounts.set(key, seen + 1);
      const failFirst = seen < (cfg?.failGetTimes ?? 0);
      if (cfg?.failGet === true || failFirst)
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
    if (
      method === 'DELETE' &&
      cfg?.failDeleteWebhookId !== undefined &&
      url.endsWith(`/webhooks/${cfg.failDeleteWebhookId}`)
    ) {
      return Promise.resolve(new Response('delete fail', { status: 500 }));
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  return { calls };
}

async function seedTrendyolStore(
  organizationId: string,
  supplierId: string,
  over: {
    webhookId?: string | null;
    webhookSecret?: string | null;
    environment?: StoreEnvironment;
    /**
     * Seed a credential blob that decrypts fine but is the wrong shape, so
     * `decryptStoreCredentials` throws — models a store whose credential is DEAD
     * (the reconciler must skip it, not blow up the whole shared-seller group).
     */
    corruptShape?: boolean;
  } = {},
): Promise<{ id: string }> {
  const { environment, corruptShape, ...rest } = over;
  const store = await createStore(organizationId, {
    externalAccountId: supplierId,
    ...(environment === undefined ? {} : { environment }),
  });
  return prisma.store.update({
    where: { id: store.id },
    data: {
      credentials:
        corruptShape === true
          ? encryptCredentials({ notTrendyol: true })
          : encryptCredentials({ supplierId, apiKey: 'k', apiSecret: 's' }),
      ...rest,
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
    process.env['TRENDYOL_SANDBOX_BASE_URL'] = TRENDYOL_SANDBOX_BASE;
    process.env['PUBLIC_API_BASE_URL'] = PUBLIC_BASE;
    // Keep a developer's shell value from leaking into the retired-prune path.
    delete process.env['WEBHOOK_PRUNE_EXTRA_BASE_URLS'];
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

  it('groups stores of the same seller AND environment (two orgs, one supplier, both PRODUCTION) into a single GET + one register each', async () => {
    // Renamed from "shared seller across two orgs": the grouping key is now
    // `${externalAccountId}::${environment}`, so this still collapses to ONE
    // group only because both stores are PRODUCTION. The PROD+SANDBOX split is
    // covered by the sibling test below.
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

  it('splits the same supplierId into separate groups per environment (PROD vs SANDBOX reconciled independently)', async () => {
    // One supplierId connected in both environments must NOT share a remote
    // list — each environment hits its own Trendyol base URL and gets its own
    // GET + register. Two orgs keep the (org, platform, supplierId) unique
    // constraint from tripping.
    const orgProd = await createOrganization();
    const orgSandbox = await createOrganization();
    const prodStore = await seedTrendyolStore(orgProd.id, SUPPLIER_ID, {
      environment: 'PRODUCTION',
      webhookId: null,
      webhookSecret: null,
    });
    const sandboxStore = await seedTrendyolStore(orgSandbox.id, SUPPLIER_ID, {
      environment: 'SANDBOX',
      webhookId: null,
      webhookSecret: null,
    });
    const { calls } = installTrendyolWebhookMock([{ supplierId: SUPPLIER_ID, remote: [] }]);

    await processWebhookReconcile();

    const getCalls = calls.filter((c) => c.method === 'GET');
    // Two independent groups → two GETs, one per environment's base URL.
    expect(getCalls.length).toBe(2);
    expect(getCalls.some((c) => c.url.startsWith(TRENDYOL_BASE))).toBe(true);
    expect(getCalls.some((c) => c.url.startsWith(TRENDYOL_SANDBOX_BASE))).toBe(true);
    const prodRow = await prisma.store.findUniqueOrThrow({ where: { id: prodStore.id } });
    const sandboxRow = await prisma.store.findUniqueOrThrow({ where: { id: sandboxStore.id } });
    expect(prodRow.webhookId).not.toBeNull();
    expect(sandboxRow.webhookId).not.toBeNull();
  });

  it('falls back to the next store credential when the first store fails the per-seller GET (shared seller heals)', async () => {
    // Shared seller, two stores. The first credential tried fails the GET; the
    // reconciler must retry with the second store's credential and heal the
    // group — a single dead credential can no longer block it forever.
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
    const { calls } = installTrendyolWebhookMock([
      { supplierId: SUPPLIER_ID, remote: [], failGetTimes: 1 },
    ]);
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await processWebhookReconcile();

    // The first GET failed and a second was issued with the fallback credential.
    expect(calls.filter((c) => c.method === 'GET').length).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      'webhook.reconcile-credential-failed',
      expect.objectContaining({ sellerId: SUPPLIER_ID }),
    );
    const rowA = await prisma.store.findUniqueOrThrow({ where: { id: storeA.id } });
    const rowB = await prisma.store.findUniqueOrThrow({ where: { id: storeB.id } });
    expect(rowA.webhookId).not.toBeNull();
    expect(rowB.webhookId).not.toBeNull();
  });

  it('isolates a per-store register failure: a store with a dead credential is skipped, the other still heals', async () => {
    // Shared seller, two stores. One store's credential decrypts to the wrong
    // shape (dead), so its register throws; that must not block the other
    // store's register — the loop logs and moves on.
    const orgGood = await createOrganization();
    const orgBad = await createOrganization();
    const goodStore = await seedTrendyolStore(orgGood.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
    });
    const badStore = await seedTrendyolStore(orgBad.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
      corruptShape: true,
    });
    installTrendyolWebhookMock([{ supplierId: SUPPLIER_ID, remote: [] }]);
    const errorSpy = vi.spyOn(syncLog, 'error');

    await processWebhookReconcile();

    const goodRow = await prisma.store.findUniqueOrThrow({ where: { id: goodStore.id } });
    const badRow = await prisma.store.findUniqueOrThrow({ where: { id: badStore.id } });
    expect(goodRow.webhookId).not.toBeNull(); // healthy store still healed
    expect(badRow.webhookId).toBeNull(); // dead-credential store left untouched
    expect(errorSpy).toHaveBeenCalledWith(
      'webhook.reconcile-store-error',
      expect.objectContaining({ storeId: badStore.id }),
    );
  });

  it('warns when a seller nears the Trendyol webhook cap (>= 13 remote hooks)', async () => {
    const org = await createOrganization();
    await seedTrendyolStore(org.id, SUPPLIER_ID, { webhookId: null, webhookSecret: null });
    const remote = Array.from({ length: WEBHOOK_NEAR_CAP_COUNT }, (_, i) => ({
      id: `orphan-${i}`,
      url: urlFor(`dead-${i}`),
      status: 'ACTIVE',
    }));
    installTrendyolWebhookMock([{ supplierId: SUPPLIER_ID, remote }]);
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await processWebhookReconcile();

    expect(warnSpy).toHaveBeenCalledWith(
      'webhook.seller-near-cap',
      expect.objectContaining({
        sellerId: SUPPLIER_ID,
        count: WEBHOOK_NEAR_CAP_COUNT,
        cap: 15,
      }),
    );
  });

  it('isolates a prune failure: a failing orphan delete does not block the subsequent register', async () => {
    // The orphan's DELETE returns 500 (ghost/double-delete). The per-hook prune
    // catch must swallow it, warn, and let the store still register.
    const org = await createOrganization();
    const store = await seedTrendyolStore(org.id, SUPPLIER_ID, {
      webhookId: null,
      webhookSecret: null,
    });
    const { calls } = installTrendyolWebhookMock([
      {
        supplierId: SUPPLIER_ID,
        remote: [{ id: 'orphan-wh', url: urlFor('dead-store'), status: 'ACTIVE' }],
        failDeleteWebhookId: 'orphan-wh',
      },
    ]);
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await processWebhookReconcile();

    // The prune was attempted and failed, warned per-hook...
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/webhooks/orphan-wh')),
    ).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'webhook.reconcile-prune-error',
      expect.objectContaining({ sellerId: SUPPLIER_ID, webhookId: 'orphan-wh' }),
    );
    // ...but the store still registered afterwards.
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    const row = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.webhookId).not.toBeNull();
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
