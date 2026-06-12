import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { getBusinessDayRange } from '@pazarsync/utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../../src/middleware/rate-limit.middleware';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../helpers/factories';
import { ensureFeeDefinitions } from '../../../helpers/seed-fee-definitions';
import { approvedProductsResponse, jsonResponse } from '../../../helpers/trendyol-fixtures';

/**
 * PR-B: webhook receiver Live Performance buffer rule.
 *
 * A cost-missing order (variant resolves, but no cost profile attached) is no
 * longer always hard-skipped. If its orderDate is TODAY (Europe/Istanbul) it is
 * written to live_performance_buffer (seller's grace window); an older orderDate
 * persists straight to orders PROFIT-EXCLUDED (spec 2026-06-12 — the cost
 * window is the order day, missing it is permanent). Unresolved variants route
 * the same way — cost_missing (spec 2026-06-11, no hard skip). Mirrors the
 * proven store/Basic-Auth setup from trendyol-orders.routes.test.ts.
 */
const STORE_PLATFORM = 'TRENDYOL' as const;
const SUPPLIER_ID = '99999';
const WEBHOOK_USER = 'pazarsync-deadbeef00000000';
const WEBHOOK_PASS = 'A'.repeat(43);
const BARCODE_COST_MISSING = 'EAN13-BUF-001';

interface PayloadOverrides {
  shipmentPackageId?: number;
  orderNumber?: string;
  orderDate?: number;
  lastModifiedDate?: number;
  barcode?: string;
}

const MS_HOUR = 60 * 60 * 1000;

/**
 * A "today" orderDate as Trendyol actually sends it: GMT+3 (Istanbul
 * wall-clock-as-UTC). The receiver normalizes it back to the true instant, so we
 * encode noon Istanbul today (real noon + the +3h offset) — a `Date.now()` value
 * would drift into "yesterday" after normalization when the suite runs between
 * 00:00 and 03:00 Istanbul. Noon is 12h from either day boundary, so the
 * today/yesterday gate is deterministic regardless of run time.
 */
function todayOrderDateGmt3(): number {
  return getBusinessDayRange().start.getTime() + 15 * MS_HOUR;
}

function makeWebhookPayload(overrides: PayloadOverrides = {}) {
  const orderDate = overrides.orderDate ?? todayOrderDateGmt3();
  return {
    orderNumber: overrides.orderNumber ?? 'buf-ord-1',
    shipmentPackageId: overrides.shipmentPackageId ?? 700000001,
    status: 'Created',
    orderDate,
    lastModifiedDate: overrides.lastModifiedDate ?? orderDate,
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 100,
    supplierId: Number.parseInt(SUPPLIER_ID, 10),
    lines: [
      {
        lineId: 1,
        sellerId: Number.parseInt(SUPPLIER_ID, 10),
        barcode: overrides.barcode ?? BARCODE_COST_MISSING,
        quantity: 1,
        lineUnitPrice: 100,
        lineGrossAmount: 100,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
  };
}

/**
 * Store with webhook Basic-Auth creds + a COST-MISSING variant: the variant
 * resolves by barcode (the gap is the cost, not the variant) but has NO
 * costProfileLinks, so resolveOrderCalculability returns `cost_missing` —
 * the buffer trigger.
 */
async function setupStore(): Promise<{ orgId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Buffer Test Store',
      platform: STORE_PLATFORM,
      environment: 'PRODUCTION',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
      webhookId: 'trendyol-wh-uuid-buf',
      webhookSecret: encryptCredentials({ username: WEBHOOK_USER, password: WEBHOOK_PASS }),
      webhookActiveAt: new Date(),
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${BARCODE_COST_MISSING}`,
      title: 'Cost-missing Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: BARCODE_COST_MISSING,
      stockCode: `sk-${BARCODE_COST_MISSING}`,
      salePrice: '100',
      listPrice: '120',
      // no costProfileLinks → cost_missing
    },
  });

  return { orgId: org.id, storeId: store.id };
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

const app = createApp();
const authOk = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);

async function postWebhook(
  storeId: string,
  payload: unknown,
  authHeader: string,
): Promise<Response> {
  return app.request(`/v1/webhooks/orders/${storeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(payload),
  });
}

describe('POST /v1/webhooks/orders/:storeId — Live Performance buffer rule (PR-B)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    _resetRateLimitStoreForTests();
    await truncateAll();
    // Late-arrival cost-missing now persists to orders, which runs
    // applyEstimateOnOrderCreate (PSF + Stopaj ESTIMATE fees) — needs the
    // FeeDefinition seed even though the estimate itself stays null (no cost).
    await ensureFeeDefinitions();
  });

  afterAll(() => {
    _resetRateLimitStoreForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cost-missing + today's orderDate → writes a PENDING buffer entry", async () => {
    const { orgId, storeId } = await setupStore();

    const res = await postWebhook(
      storeId,
      makeWebhookPayload({ orderDate: todayOrderDateGmt3() }),
      authOk,
    );
    expect(res.status).toBe(200);

    const entries = await prisma.livePerformanceBuffer.findMany({ where: { storeId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('PENDING');
    expect(entries[0]!.organizationId).toBe(orgId);
    expect(entries[0]!.platformOrderId).toBe('700000001');
    expect(entries[0]!.platformOrderNumber).toBe('buf-ord-1');
  });

  it('cost-missing + previous-day orderDate → persists PROFIT-EXCLUDED, no buffer write', async () => {
    const { orgId, storeId } = await setupStore();
    const yesterday = todayOrderDateGmt3() - 24 * MS_HOUR;

    const res = await postWebhook(
      storeId,
      makeWebhookPayload({
        shipmentPackageId: 700000002,
        orderNumber: 'buf-late',
        orderDate: yesterday,
      }),
      authOk,
    );
    expect(res.status).toBe(200);

    // Spec 2026-06-12: pencere kapandı → kâr-dışı yazım; ciro kayıtlı, buffer yok.
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
    expect(order.organizationId).toBe(orgId);
    expect(order.platformOrderId).toBe('700000002');
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    expect(order.profitExcludedAt).not.toBeNull();
  });

  it('katalogda olmayan barkod intake anında vendor sorgusuyla eklenir ve satır eşleşmiş olarak buffera düşer', async () => {
    const { storeId } = await setupStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/products/approved') && url.includes('barcode=EAGER-NEW-1')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('EAGER-NEW-1', 1)));
      }
      throw new Error(`beklenmeyen fetch: ${url}`);
    });

    const res = await postWebhook(
      storeId,
      makeWebhookPayload({
        shipmentPackageId: 700000010,
        orderNumber: 'eager-1',
        barcode: 'EAGER-NEW-1',
      }),
      authOk,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    // Ürün kataloğa anında girdi…
    expect(await prisma.productVariant.count({ where: { storeId, barcode: 'EAGER-NEW-1' } })).toBe(
      1,
    );
    // …maliyetsiz doğduğu için sipariş bugünkü pencereye (buffer) düştü.
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(1);
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
  });

  it('vendor hatası intake sürecini bloke etmez — satır eşleşmeden buffera düşer (K6)', async () => {
    const { storeId } = await setupStore();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/products/approved')) {
        return Promise.resolve(new Response('bad credentials', { status: 401 }));
      }
      throw new Error(`beklenmeyen fetch: ${url}`);
    });

    const res = await postWebhook(
      storeId,
      makeWebhookPayload({
        shipmentPackageId: 700000011,
        orderNumber: 'eager-2',
        barcode: 'EAGER-GONE-2',
      }),
      authOk,
    );
    expect(res.status).toBe(200);
    expect(await prisma.productVariant.count({ where: { storeId, barcode: 'EAGER-GONE-2' } })).toBe(
      0,
    );
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(1);
  });

  it('duplicate webhook for the same package → P2002 dedupe, single buffer entry', async () => {
    const { storeId } = await setupStore();
    const today = todayOrderDateGmt3();
    const base = { shipmentPackageId: 700000003, orderNumber: 'buf-dup', orderDate: today };

    const r1 = await postWebhook(
      storeId,
      makeWebhookPayload({ ...base, lastModifiedDate: today }),
      authOk,
    );
    expect(r1.status).toBe(200);
    // Different lastModifiedDate → distinct WebhookEvent (no event dedupe), so the
    // request reaches the buffer branch again and the buffer composite unique dedupes.
    const r2 = await postWebhook(
      storeId,
      makeWebhookPayload({ ...base, lastModifiedDate: today + 1000 }),
      authOk,
    );
    expect(r2.status).toBe(200);

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(1);
  });

  it('unmatched variant + today → buffered like cost_missing (spec 2026-06-11)', async () => {
    const { storeId } = await setupStore();

    const res = await postWebhook(
      storeId,
      makeWebhookPayload({
        shipmentPackageId: 700000004,
        orderNumber: 'buf-novariant',
        barcode: 'UNKNOWN-BARCODE-XYZ',
      }),
      authOk,
    );
    expect(res.status).toBe(200);
    // The variant gap no longer hard-skips: today's order takes the buffer
    // route (revenue visible immediately; cost waits for resolution).
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(1);
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
  });
});
