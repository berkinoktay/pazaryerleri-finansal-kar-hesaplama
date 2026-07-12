/**
 * Runs under the INLINE escape hatch (WEBHOOK_INTAKE_INLINE='true', set in
 * beforeAll/afterAll below). After Paket D §D6's permanent cutover (#460) the
 * route defaults to DEFERRED intake (persist + 200; the sync-worker consumer tick
 * processes the row), so a fresh webhook writes no order in-request. This suite's
 * subject is the in-request intake processing semantics (order upsert, status
 * mapping, calculability gate, RETURNED→CLAIMS, production gate), so it opts into
 * inline mode to keep exercising that contract with the least diff. The deferred
 * default is covered by webhook-intake-modes.test.ts.
 */
import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { encryptCredentials, syncLog } from '@pazarsync/sync-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../../src/middleware/rate-limit.middleware';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../helpers/factories';
import { ensureFeeDefinitions } from '../../../helpers/seed-fee-definitions';

const STORE_PLATFORM = 'TRENDYOL' as const;
const SUPPLIER_ID = '99999';
const WEBHOOK_USER = 'pazarsync-deadbeef00000000';
const WEBHOOK_PASS = 'A'.repeat(43); // 43-char base64url-shaped password (test only)

// Webhook order dates must fall after the FeeDefinition seed (effectiveFrom
// 2026-05-18) so applyEstimateOnOrderCreate can resolve PSF/Stopaj rows.
const ORDER_DATE_MS = Date.UTC(2026, 4, 19);
const LAST_MODIFIED_MS = Date.UTC(2026, 4, 20);
const DELIVERED_AT_MS = Date.UTC(2026, 4, 20, 12);

interface WebhookPayloadOverrides {
  shipmentPackageId?: number;
  orderNumber?: string;
  status?: string;
  supplierId?: number;
  lastModifiedDate?: number;
  createdBy?: string;
  lines?: unknown[];
}

function makeWebhookPayload(overrides: WebhookPayloadOverrides = {}) {
  return {
    orderNumber: overrides.orderNumber ?? '11101228439',
    shipmentPackageId: overrides.shipmentPackageId ?? 3734026895,
    status: overrides.status ?? 'Delivered',
    orderDate: ORDER_DATE_MS,
    lastModifiedDate: overrides.lastModifiedDate ?? LAST_MODIFIED_MS,
    agreedDeliveryDate: Date.UTC(2026, 4, 21),
    fastDelivery: false,
    micro: false,
    // GROSS konvansiyon (2026-06-16): saleGross = packageTotalPrice (satış toplamı,
    // KDV-dahil); listGross = packageGrossAmount. İndirim yok → ikisi de 120.
    packageGrossAmount: 120,
    packageTotalPrice: 120,
    supplierId: overrides.supplierId ?? Number.parseInt(SUPPLIER_ID, 10),
    lines: overrides.lines ?? [
      {
        lineId: 1,
        sellerId: overrides.supplierId ?? Number.parseInt(SUPPLIER_ID, 10),
        barcode: 'EAN13-WH-001',
        quantity: 1,
        lineUnitPrice: 120,
        lineGrossAmount: 120,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
    packageHistories: [{ status: 'Delivered', createdDate: DELIVERED_AT_MS }],
    ...(overrides.createdBy !== undefined ? { createdBy: overrides.createdBy } : {}),
  };
}

async function setupStore(
  overrides: { environment?: 'PRODUCTION' | 'SANDBOX' } = {},
): Promise<{ orgId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const webhookSecret = encryptCredentials({
    username: WEBHOOK_USER,
    password: WEBHOOK_PASS,
  });

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Webhook Test Store',
      platform: STORE_PLATFORM,
      environment: overrides.environment ?? 'PRODUCTION',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({
        supplierId: SUPPLIER_ID,
        apiKey: 'k',
        apiSecret: 's',
      }),
      webhookId: 'trendyol-wh-uuid-12345',
      webhookSecret,
      webhookActiveAt: new Date(),
    },
  });

  // Seed a calculable variant for the default webhook payload barcode so the
  // happy/idempotency/transfer paths clear the V1 calculability gate (PR-B).
  const costProfile = await createCostProfile(org.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-EAN13-WH-001`,
      title: 'Webhook Test Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: 'EAN13-WH-001',
      stockCode: 'sk-EAN13-WH-001',
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: { create: { organizationId: org.id, profileId: costProfile.id } },
    },
  });

  return { orgId: org.id, storeId: store.id };
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

const app = createApp();

async function postWebhook(
  storeId: string,
  payload: unknown,
  authHeader: string,
): Promise<Response> {
  return app.request(`/v1/webhooks/orders/${storeId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });
}

describe('POST /v1/webhooks/orders/:storeId (PR-C3b)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
    // Opt into the inline escape hatch so the route processes in-request. Set via
    // process.env directly (not vi.stubEnv) so the nested `vi.unstubAllEnvs()` in
    // the production-gate describe cannot clear it mid-suite.
    process.env['WEBHOOK_INTAKE_INLINE'] = 'true';
  });

  beforeEach(async () => {
    _resetRateLimitStoreForTests();
    await truncateAll();
    await ensureFeeDefinitions();
  });

  afterEach(() => {
    // Eager-repair fetch spy'ları (spec 2026-06-12 PR-2) testler arasında sızmasın.
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    _resetRateLimitStoreForTests();
    delete process.env['WEBHOOK_INTAKE_INLINE'];
  });

  describe('Auth', () => {
    it('401 when Authorization header is missing', async () => {
      const { storeId } = await setupStore();
      const res = await app.request(`/v1/webhooks/orders/${storeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeWebhookPayload()),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('401 when Authorization scheme is not Basic', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(storeId, makeWebhookPayload(), 'Bearer wat');
      expect(res.status).toBe(401);
    });

    it('401 when Basic Auth credentials mismatch', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, 'wrong-pass'),
      );
      expect(res.status).toBe(401);
    });

    it('404 (non-disclosure) when storeId is unknown + logs store_not_found', async () => {
      const warnSpy = vi.spyOn(syncLog, 'warn');
      const res = await postWebhook(
        '00000000-0000-0000-0000-000000000000',
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(404);
      expect(warnSpy).toHaveBeenCalledWith(
        'webhook.store-not-found-or-disabled',
        expect.objectContaining({ reason: 'store_not_found' }),
      );
      warnSpy.mockRestore();
    });

    it('404 when store exists but webhookSecret is null (disabled) + logs webhook_secret_null', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: 'Disabled-webhook Store',
          platform: STORE_PLATFORM,
          environment: 'PRODUCTION',
          externalAccountId: SUPPLIER_ID,
          credentials: 'irrelevant',
          // webhookSecret null on purpose
        },
      });

      const warnSpy = vi.spyOn(syncLog, 'warn');
      const res = await postWebhook(
        store.id,
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(404);
      expect(warnSpy).toHaveBeenCalledWith(
        'webhook.store-not-found-or-disabled',
        expect.objectContaining({ storeId: store.id, reason: 'webhook_secret_null' }),
      );
      warnSpy.mockRestore();
    });
  });

  describe('Defense-in-depth supplierId check', () => {
    it('200 (deterministic drop) + writes a CLOSED audit row when payload supplierId does not match store externalAccountId', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload({ supplierId: 88888 }),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      // Retry-model (webhook-model.md): a body that names another seller is a
      // deterministic dead-end — 200 closes the event so Trendyol stops
      // retrying. Identity was already proven at the auth layer.
      expect(res.status).toBe(200);

      // The drop now leaves a durable audit trail: a CLOSED webhook_events row
      // (processedAt set + 'dropped:'-prefixed processingError), but NO order.
      const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
      expect(event.platformOrderId).toBe('3734026895');
      expect(event.processedAt).not.toBeNull();
      expect(event.processingError).toBe('dropped: supplier mismatch');
      expect(await prisma.order.count({ where: { storeId } })).toBe(0);
      expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(0);
    });

    it('re-delivery of the same mismatch drop stays 200 and does NOT write a second audit row', async () => {
      const { storeId } = await setupStore();
      const auth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);
      const payload = makeWebhookPayload({ supplierId: 88888 });

      const first = await postWebhook(storeId, payload, auth);
      expect(first.status).toBe(200);
      // Same body redelivered (Trendyol 5-minute retry) → P2002 on the audit
      // INSERT → silent 200, no duplicate row.
      const second = await postWebhook(storeId, payload, auth);
      expect(second.status).toBe(200);

      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
      expect(await prisma.order.count({ where: { storeId } })).toBe(0);
    });
  });

  describe('Happy path', () => {
    it('upserts Order + writes WebhookEvent with processedAt set + 200 OK', async () => {
      const { orgId, storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(200);

      const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
      expect(order.organizationId).toBe(orgId);
      expect(order.platformOrderId).toBe('3734026895');
      expect(order.status).toBe('DELIVERED');
      expect(order.actualDeliveryDate?.getTime()).toBe(DELIVERED_AT_MS);
      // GROSS konvansiyon (2026-06-16): saleGross = paket satış toplamı (KDV-dahil).
      // lineGrossAmount 120 × qty 1, indirim 0 → saleGross 120 (eski net 100 = 120/1.20).
      expect(new Decimal(order.saleGross!).toString()).toBe('120');

      const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
      expect(event.platformOrderId).toBe('3734026895');
      expect(event.platformStatus).toBe('Delivered');
      expect(event.processedAt).not.toBeNull();
      expect(event.processingError).toBeNull();

      // applyEstimate plug-in wrote PSF + Stopaj OrderFees
      const fees = await prisma.orderFee.findMany({
        where: { orderId: order.id },
        orderBy: { feeType: 'asc' },
      });
      expect(fees.map((f) => f.feeType)).toEqual(['PLATFORM_SERVICE', 'STOPPAGE']);
    });
  });

  describe('Idempotency', () => {
    it('re-delivery with same composite key returns 200 + skip (no duplicate Order / WebhookEvent rows)', async () => {
      const { storeId } = await setupStore();
      const auth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);
      const payload = makeWebhookPayload();

      // First delivery
      const first = await postWebhook(storeId, payload, auth);
      expect(first.status).toBe(200);

      // Re-delivery (Trendyol 5-minute retry)
      const second = await postWebhook(storeId, payload, auth);
      expect(second.status).toBe(200);

      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
      expect(await prisma.order.count({ where: { storeId } })).toBe(1);
    });

    it('different lastModifiedDate creates a new WebhookEvent (status transition)', async () => {
      const { storeId } = await setupStore();
      const auth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);

      await postWebhook(
        storeId,
        makeWebhookPayload({ status: 'Picking', lastModifiedDate: LAST_MODIFIED_MS }),
        auth,
      );
      await postWebhook(
        storeId,
        makeWebhookPayload({ status: 'Shipped', lastModifiedDate: LAST_MODIFIED_MS + 1000 }),
        auth,
      );
      await postWebhook(
        storeId,
        makeWebhookPayload({ status: 'Delivered', lastModifiedDate: LAST_MODIFIED_MS + 2000 }),
        auth,
      );

      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(3);
      expect(await prisma.order.count({ where: { storeId } })).toBe(1);

      const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
      expect(order.status).toBe('DELIVERED');
    });
  });

  describe('Status mapping fallback', () => {
    it('unknown status returns 200 + logs WebhookEvent but does NOT upsert Order', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload({ status: 'EXOTIC_NEW_STATUS' }),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(200);

      // WebhookEvent yazılır (audit), processedAt set
      const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
      expect(event.platformStatus).toBe('EXOTIC_NEW_STATUS');
      expect(event.processedAt).not.toBeNull();

      // Order yazılmaz (DOKUNULMAZ politikası)
      expect(await prisma.order.count({ where: { storeId } })).toBe(0);
    });
  });

  describe('createdBy transfer override', () => {
    it("createdBy='transfer' → Order.status = CANCELLED even if Trendyol status is Delivered", async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload({ status: 'Delivered', createdBy: 'transfer' }),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(200);

      const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
      expect(order.status).toBe('CANCELLED');
    });
  });

  describe('Malformed payload', () => {
    it('200 (deterministic drop) when shipmentPackageId is missing (Zod payload check)', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        { ...makeWebhookPayload(), shipmentPackageId: undefined },
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      // Retry-model reversal (webhook-model.md): Trendyol retries 4xx forever,
      // so the webhook-specific defaultHook logs the issue codes and returns
      // 200 to close the event instead of 422. No WebhookEvent row is written
      // (the hook short-circuits before the handler's INSERT).
      expect(res.status).toBe(200);
      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(0);
    });
  });

  describe('Calculability gate (PR-B)', () => {
    it('persists the order with a null-variant item when a line has no matching variant', async () => {
      const { storeId } = await setupStore();
      // Eager katalog onarımı (spec 2026-06-12 PR-2) bilinmeyen barkod için
      // vendor'a çıkar — deterministik vendor-miss: barkod Trendyol'da da yok,
      // satır eşleşmeden devam eder (gerçek ağ çağrısı testte yasak).
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = String(input);
        if (url.includes('/products/approved')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totalElements: 0,
                totalPages: 0,
                page: 0,
                size: 100,
                nextPageToken: null,
                content: [],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        throw new Error(`beklenmeyen fetch: ${url}`);
      });
      const payload = makeWebhookPayload({
        orderNumber: 'NO-VARIANT-1',
        shipmentPackageId: 555000001,
        lines: [
          {
            lineId: 1,
            sellerId: Number.parseInt(SUPPLIER_ID, 10),
            barcode: 'UNKNOWN-BARCODE-XYZ',
            quantity: 1,
            lineUnitPrice: 100,
            lineGrossAmount: 100,
            lineSellerDiscount: 0,
            vatRate: 20,
            commission: 10,
          },
        ],
      });
      const res = await postWebhook(storeId, payload, basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS));
      expect(res.status).toBe(200);
      // Spec 2026-06-11: the variant gap no longer skips — ORDER_DATE_MS is
      // past-day, so the order persists PROFIT-EXCLUDED (spec 2026-06-12:
      // LATE_UNCOSTED_ARRIVAL) and the unmatched line keeps the barcode trail.
      const order = await prisma.order.findFirstOrThrow({
        where: { storeId, platformOrderId: '555000001' },
      });
      expect(order.estimatedNetProfit).toBeNull();
      expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
      expect(order.profitExcludedAt).not.toBeNull();
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(item.productVariantId).toBeNull();
      expect(item.barcode).toBe('UNKNOWN-BARCODE-XYZ');
      const event = await prisma.webhookEvent.findFirstOrThrow({
        where: { storeId, platformOrderId: '555000001' },
      });
      expect(event.processedAt).not.toBeNull();
    });

    it('persists PROFIT-EXCLUDED (past-day cost-missing) when the variant exists but has no cost profile', async () => {
      const { orgId, storeId } = await setupStore();
      // Seed a SECOND variant with NO cost link.
      const product = await prisma.product.create({
        data: {
          organizationId: orgId,
          storeId,
          platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
          productMainId: 'pm-EAN13-NOCOST',
          title: 'No-cost Product',
        },
      });
      await prisma.productVariant.create({
        data: {
          organizationId: orgId,
          storeId,
          productId: product.id,
          platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
          barcode: 'EAN13-NOCOST',
          stockCode: 'sk-EAN13-NOCOST',
          salePrice: '100',
          listPrice: '120',
        },
      });
      const payload = makeWebhookPayload({
        orderNumber: 'NO-COST-1',
        shipmentPackageId: 555000002,
        lines: [
          {
            lineId: 1,
            sellerId: Number.parseInt(SUPPLIER_ID, 10),
            barcode: 'EAN13-NOCOST',
            quantity: 1,
            lineUnitPrice: 100,
            lineGrossAmount: 100,
            lineSellerDiscount: 0,
            vatRate: 20,
            commission: 10,
          },
        ],
      });
      const res = await postWebhook(storeId, payload, basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS));
      expect(res.status).toBe(200);
      // Spec 2026-06-12: ORDER_DATE_MS is past-day → cost window already closed →
      // the order persists PROFIT-EXCLUDED, not skipped. No buffer entry for past-day.
      const order = await prisma.order.findFirstOrThrow({
        where: { storeId, platformOrderId: '555000002' },
      });
      expect(order.organizationId).toBe(orgId);
      expect(order.estimatedNetProfit).toBeNull();
      expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
      expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(0);
    });
  });

  describe('RETURNED webhook enqueues CLAIMS sync (Task 8)', () => {
    it('Test A: RETURNED webhook enqueues exactly one CLAIMS SyncLog for the store', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload({
          status: 'Returned',
          shipmentPackageId: 9900000001,
          orderNumber: 'RETURNED-A-001',
          lastModifiedDate: LAST_MODIFIED_MS + 5000,
        }),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(200);

      const claimsSyncLogs = await prisma.syncLog.findMany({
        where: {
          storeId,
          syncType: 'CLAIMS',
          status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] },
        },
      });
      expect(claimsSyncLogs).toHaveLength(1);
    });

    it('Test B: second RETURNED webhook when a CLAIMS sync already pending → still exactly one (dedup)', async () => {
      const { storeId } = await setupStore();
      const auth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);

      // İlk RETURNED webhook — CLAIMS SyncLog enqueue edilir
      const first = await postWebhook(
        storeId,
        makeWebhookPayload({
          status: 'Returned',
          shipmentPackageId: 9900000002,
          orderNumber: 'RETURNED-B-001',
          lastModifiedDate: LAST_MODIFIED_MS + 6000,
        }),
        auth,
      );
      expect(first.status).toBe(200);

      // İkinci RETURNED webhook (farklı sipariş, farklı lastModifiedDate) —
      // mevcut CLAIMS SyncLog zaten aktif, dedup çalışmalı, yeni satır açılmamalı.
      const second = await postWebhook(
        storeId,
        makeWebhookPayload({
          status: 'Returned',
          shipmentPackageId: 9900000003,
          orderNumber: 'RETURNED-B-002',
          lastModifiedDate: LAST_MODIFIED_MS + 7000,
        }),
        auth,
      );
      expect(second.status).toBe(200);

      // Dedup: hâlâ tek aktif CLAIMS SyncLog satırı
      const claimsSyncLogs = await prisma.syncLog.findMany({
        where: {
          storeId,
          syncType: 'CLAIMS',
          status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] },
        },
      });
      expect(claimsSyncLogs).toHaveLength(1);

      // Her iki sipariş de yazılmış olmalı
      expect(await prisma.order.count({ where: { storeId } })).toBe(2);
    });

    it('Test C: non-RETURNED webhook (Delivered) does NOT enqueue a CLAIMS sync', async () => {
      const { storeId } = await setupStore();
      const res = await postWebhook(
        storeId,
        makeWebhookPayload({ status: 'Delivered' }),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );
      expect(res.status).toBe(200);

      const claimsSyncLogs = await prisma.syncLog.findMany({
        where: { storeId, syncType: 'CLAIMS' },
      });
      expect(claimsSyncLogs).toHaveLength(0);
    });
  });

  describe('PRODUCTION-only intake gate (defense-in-depth)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('drops SANDBOX-store webhooks in production with 200 + skip log + CLOSED audit row, no order', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { storeId } = await setupStore({ environment: 'SANDBOX' });
      const infoSpy = vi.spyOn(syncLog, 'info');

      const res = await postWebhook(
        storeId,
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );

      expect(res.status).toBe(200);
      expect(infoSpy).toHaveBeenCalledWith(
        'webhook.sandbox-dropped-in-production',
        expect.objectContaining({ storeId, platformOrderId: '3734026895' }),
      );
      // The drop leaves a durable audit trail: a CLOSED webhook_events row
      // (processedAt set + 'dropped:'-prefixed processingError), but NO order
      // (the SANDBOX gate never runs intake).
      const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
      expect(event.processedAt).not.toBeNull();
      expect(event.processingError).toBe('dropped: sandbox delivery in production');
      expect(await prisma.order.count({ where: { storeId } })).toBe(0);
      expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(0);

      infoSpy.mockRestore();
    });

    it('re-delivery of the same SANDBOX drop in production stays 200 and writes no second audit row', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { storeId } = await setupStore({ environment: 'SANDBOX' });
      const auth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);
      const payload = makeWebhookPayload();

      const first = await postWebhook(storeId, payload, auth);
      expect(first.status).toBe(200);
      // Same body redelivered → P2002 on the audit INSERT → silent 200, no dup.
      const second = await postWebhook(storeId, payload, auth);
      expect(second.status).toBe(200);

      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
      expect(await prisma.order.count({ where: { storeId } })).toBe(0);
    });

    it('still intakes PRODUCTION-store webhooks normally when NODE_ENV=production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { storeId } = await setupStore({ environment: 'PRODUCTION' });

      const res = await postWebhook(
        storeId,
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );

      expect(res.status).toBe(200);
      // Gate does NOT fire — the receiver upserts the order as usual.
      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
      expect(await prisma.order.count({ where: { storeId } })).toBe(1);
    });

    it('still intakes SANDBOX-store webhooks when NODE_ENV is not production (dev/stage runbook)', async () => {
      // Default test env is NODE_ENV=test — gate must not fire.
      const { storeId } = await setupStore({ environment: 'SANDBOX' });

      const res = await postWebhook(
        storeId,
        makeWebhookPayload(),
        basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
      );

      expect(res.status).toBe(200);
      expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
      expect(await prisma.order.count({ where: { storeId } })).toBe(1);
    });
  });
});
