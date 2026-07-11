/**
 * Webhook ingest modes + transient contract (Paket D §D3/D5/D6).
 *
 * Covers the behaviour that changed when the durable `webhook_events` queue +
 * the sync-worker consumer tick became the replay engine:
 *   (a) a transient processing fault now returns 200 with a backoff instead of a
 *       5xx — the row is left unprocessed for a later replay.
 *   (b) deferred mode (WEBHOOK_INTAKE_DEFERRED='true') persists the row UNLEASED
 *       and returns 200 without processing — the consumer tick claims it.
 *   (c) a re-delivery of an unprocessed row is a no-op (its lease owner drives it).
 *   (d) the default in-request path makes ZERO vendor calls (catalogRepair
 *       'deferred'), yet still writes the order.
 */
import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../../src/middleware/rate-limit.middleware';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
  createWebhookEvent,
} from '../../../helpers/factories';
import { ensureFeeDefinitions } from '../../../helpers/seed-fee-definitions';

const STORE_PLATFORM = 'TRENDYOL' as const;
const SUPPLIER_ID = '55555';
const WEBHOOK_USER = 'pazarsync-modes000000000';
const WEBHOOK_PASS = 'M'.repeat(43);
const CALCULABLE_BARCODE = 'EAN13-MODE-001';
const UNCATALOGUED_BARCODE = 'MODE-UNCATALOGUED-XYZ';

// Order dates must fall after the FeeDefinition seed (effectiveFrom 2026-05-18).
const ORDER_DATE_MS = Date.UTC(2026, 4, 19);
const LAST_MODIFIED_MS = Date.UTC(2026, 4, 20);

interface PayloadOverrides {
  shipmentPackageId?: number;
  orderNumber?: string;
  status?: string;
  lastModifiedDate?: number;
  barcode?: string;
}

function makeWebhookPayload(overrides: PayloadOverrides = {}) {
  const barcode = overrides.barcode ?? CALCULABLE_BARCODE;
  return {
    orderNumber: overrides.orderNumber ?? '11101228441',
    shipmentPackageId: overrides.shipmentPackageId ?? 4834026801,
    status: overrides.status ?? 'Delivered',
    orderDate: ORDER_DATE_MS,
    lastModifiedDate: overrides.lastModifiedDate ?? LAST_MODIFIED_MS,
    agreedDeliveryDate: Date.UTC(2026, 4, 21),
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 120,
    packageTotalPrice: 120,
    supplierId: Number.parseInt(SUPPLIER_ID, 10),
    lines: [
      {
        lineId: 1,
        sellerId: Number.parseInt(SUPPLIER_ID, 10),
        barcode,
        quantity: 1,
        lineUnitPrice: 120,
        lineGrossAmount: 120,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
    packageHistories: [{ status: 'Delivered', createdDate: LAST_MODIFIED_MS }],
  };
}

async function setupStore(): Promise<{ orgId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Ingest Modes Store',
      platform: STORE_PLATFORM,
      environment: 'PRODUCTION',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
      webhookId: 'trendyol-wh-modes',
      webhookSecret: encryptCredentials({ username: WEBHOOK_USER, password: WEBHOOK_PASS }),
      webhookActiveAt: new Date(),
    },
  });

  // Calculable variant for the default barcode so the happy path writes an order.
  const costProfile = await createCostProfile(org.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${CALCULABLE_BARCODE}`,
      title: 'Ingest Modes Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: CALCULABLE_BARCODE,
      stockCode: `sk-${CALCULABLE_BARCODE}`,
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
const authOk = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);

async function postWebhook(storeId: string, payload: unknown): Promise<Response> {
  return app.request(`/v1/webhooks/orders/${storeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authOk },
    body: JSON.stringify(payload),
  });
}

describe('Webhook ingest modes + transient contract (Paket D §D3/D5/D6)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    _resetRateLimitStoreForTests();
    await truncateAll();
    await ensureFeeDefinitions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    _resetRateLimitStoreForTests();
  });

  it('(a) transient processing fault → 200 + backoff (unprocessed, attempts=1, no order)', async () => {
    const { storeId } = await setupStore();
    // Remove the COMMISSION_INVOICE fee definition the intake resolves FIRST so
    // `resolveFeeDefinition` throws FeeDefinitionNotFoundError — a transient
    // fault (missing seed = misconfiguration, not a payload defect).
    await prisma.feeDefinition.deleteMany({ where: { feeType: 'COMMISSION_INVOICE' } });

    const before = Date.now();
    const res = await postWebhook(storeId, makeWebhookPayload());
    // Transient no longer 5xx: the queue + consumer tick are the replay engine.
    expect(res.status).toBe(200);

    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    // Left unprocessed with a recorded error + a future retry window.
    expect(event.processedAt).toBeNull();
    expect(event.processingError).not.toBeNull();
    expect(event.processingError).toContain('COMMISSION_INVOICE');
    expect(event.processAttempts).toBe(1);
    expect(event.nextProcessAt).not.toBeNull();
    expect(event.nextProcessAt!.getTime()).toBeGreaterThan(before);
    // The fault fired before any order write.
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
  });

  it('(b) deferred mode → 200 + row persisted UNLEASED (next_process_at null, attempts 0), no order', async () => {
    vi.stubEnv('WEBHOOK_INTAKE_DEFERRED', 'true');
    const { storeId } = await setupStore();

    const res = await postWebhook(storeId, makeWebhookPayload());
    expect(res.status).toBe(200);

    // Persisted but NOT leased or processed — the consumer tick will claim it.
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).toBeNull();
    expect(event.processingError).toBeNull();
    expect(event.processAttempts).toBe(0);
    expect(event.nextProcessAt).toBeNull();
    // No in-request processing → no order yet (it lands via the tick, unexercised here).
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
  });

  it('(c) re-delivery of an unprocessed row → 200, NOT reprocessed (attempts unchanged)', async () => {
    const { orgId, storeId } = await setupStore();
    const payload = makeWebhookPayload();
    // Seed an unprocessed idempotency row matching the payload's composite key.
    const seeded = await createWebhookEvent(orgId, storeId, {
      platformOrderId: String(payload.shipmentPackageId),
      platformStatus: payload.status,
      platformLastModifiedDate: new Date(payload.lastModifiedDate),
      processedAt: null,
    });

    const res = await postWebhook(storeId, payload);
    expect(res.status).toBe(200);

    // P2002 re-delivery → handleReDelivery no-op: no lease claim, no reprocess.
    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(event.processedAt).toBeNull();
    expect(event.processAttempts).toBe(0);
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
  });

  it('(d) default mode success → order + processedAt, and ZERO vendor calls (catalogRepair deferred)', async () => {
    const { storeId } = await setupStore();
    // Tripwire: the request path must never touch the vendor (D5). ensureBarcodes
    // would fetch this uncatalogued barcode in the retired eager mode.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      throw new Error(`vendor must not be called in the request path: ${String(input)}`);
    });

    const res = await postWebhook(
      storeId,
      makeWebhookPayload({
        shipmentPackageId: 4834026802,
        orderNumber: 'deferred-catalog-1',
        barcode: UNCATALOGUED_BARCODE,
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    // The order is written even though the barcode is not in the catalog: the
    // unmatched line persists PROFIT-EXCLUDED (past-day cost-missing) with its
    // barcode trail, and the event closes.
    const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
    expect(order.platformOrderId).toBe('4834026802');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.productVariantId).toBeNull();
    expect(item.barcode).toBe(UNCATALOGUED_BARCODE);
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).not.toBeNull();
    expect(event.processingError).toBeNull();
  });

  it('(d2) default mode, calculable barcode → order with estimate + processedAt, still no vendor call', async () => {
    const { storeId } = await setupStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      throw new Error(`vendor must not be called in the request path: ${String(input)}`);
    });

    const res = await postWebhook(storeId, makeWebhookPayload());
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
    expect(order.status).toBe('DELIVERED');
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).not.toBeNull();
    expect(event.processingError).toBeNull();
  });
});
