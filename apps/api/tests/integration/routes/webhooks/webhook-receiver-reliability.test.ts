/**
 * Webhook receiver reliability — audit-driven hardening of the Trendyol order
 * webhook intake path (branch: fix/webhook-receiver-reliability).
 *
 * Central vendor fact (webhook-model.md "Webhook Önemli Notlar"): Trendyol
 * replays every FAILED delivery (4xx included) every 5 minutes until it
 * succeeds, then flips the webhook to PASSIVE. After Paket D the durable
 * `webhook_events` queue + the consumer tick are the replay engine, so the
 * receiver:
 *   - returns 200 for deterministic dead-ends (bad body, supplier mismatch),
 *   - returns 200 for a transient processing fault too (the row is left
 *     unprocessed with a backoff for a later replay — no 5xx),
 *   - does NOT reprocess an unprocessed event on re-delivery (its lease owner
 *     drives it), regardless of age,
 *   - self-heals a stale credential and a bad storeId shape without a 500.
 *
 * Runs under the INLINE escape hatch (WEBHOOK_INTAKE_INLINE='true', set in
 * beforeAll/afterAll). After Paket D §D6's permanent cutover (#460) the route
 * defaults to DEFERRED intake, so a fresh webhook does no in-request processing.
 * This suite's subject is the in-request intake processing semantics, so it opts
 * into inline mode to keep exercising that contract with the least diff. The
 * deferred default is covered by webhook-intake-modes.test.ts.
 */

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../../src/middleware/rate-limit.middleware';
import {
  WEBHOOK_AUTH_FAIL_MIN_COUNT,
  WEBHOOK_AUTH_FAIL_MIN_DURATION_MS,
  _backdateWebhookAuthFailureForTests,
  _resetWebhookAuthFailuresForTests,
} from '../../../../src/middleware/verify-trendyol-webhook.middleware';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../helpers/factories';
import { ensureFeeDefinitions } from '../../../helpers/seed-fee-definitions';

const STORE_PLATFORM = 'TRENDYOL' as const;
const SUPPLIER_ID = '77777';
const WEBHOOK_USER = 'pazarsync-reliab00000000';
const WEBHOOK_PASS = 'R'.repeat(43);
const BARCODE = 'EAN13-REL-001';

// Order date must fall after the FeeDefinition seed (effectiveFrom 2026-05-18).
const ORDER_DATE_MS = Date.UTC(2026, 4, 19);
const LAST_MODIFIED_MS = Date.UTC(2026, 4, 20);

interface PayloadOverrides {
  shipmentPackageId?: number;
  status?: string;
  supplierId?: number;
  lastModifiedDate?: number;
  lines?: unknown[];
}

function makeWebhookPayload(overrides: PayloadOverrides = {}) {
  return {
    orderNumber: '11101228440',
    shipmentPackageId: overrides.shipmentPackageId ?? 4734026800,
    status: overrides.status ?? 'Delivered',
    orderDate: ORDER_DATE_MS,
    lastModifiedDate: overrides.lastModifiedDate ?? LAST_MODIFIED_MS,
    agreedDeliveryDate: Date.UTC(2026, 4, 21),
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 120,
    packageTotalPrice: 120,
    supplierId: overrides.supplierId ?? Number.parseInt(SUPPLIER_ID, 10),
    lines: overrides.lines ?? [
      {
        lineId: 1,
        sellerId: overrides.supplierId ?? Number.parseInt(SUPPLIER_ID, 10),
        barcode: BARCODE,
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
      name: 'Reliability Test Store',
      platform: STORE_PLATFORM,
      environment: 'PRODUCTION',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
      webhookId: 'trendyol-wh-reliab',
      webhookSecret: encryptCredentials({ username: WEBHOOK_USER, password: WEBHOOK_PASS }),
      webhookActiveAt: new Date(),
    },
  });

  // Calculable variant for the payload barcode so intake writes an order.
  const costProfile = await createCostProfile(org.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${BARCODE}`,
      title: 'Reliability Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: BARCODE,
      stockCode: `sk-${BARCODE}`,
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

async function postWebhook(storeId: string, body: string, authHeader: string): Promise<Response> {
  return app.request(`/v1/webhooks/orders/${storeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body,
  });
}

/** Insert an idempotency row matching the default payload's composite key. */
async function seedWebhookEvent(
  orgId: string,
  storeId: string,
  opts: { processedAt: Date | null; receivedAt: Date },
): Promise<string> {
  const payload = makeWebhookPayload();
  const row = await prisma.webhookEvent.create({
    data: {
      organizationId: orgId,
      storeId,
      platform: 'TRENDYOL',
      platformOrderId: String(payload.shipmentPackageId),
      platformStatus: payload.status,
      platformLastModifiedDate: new Date(payload.lastModifiedDate),
      // Reprocessing reads the incoming re-delivery body, not this stored
      // payload, so a minimal marker suffices here.
      rawPayload: { shipmentPackageId: payload.shipmentPackageId, status: payload.status },
      processedAt: opts.processedAt,
    },
    select: { id: true },
  });
  // receivedAt defaults to now(); override to control the reprocess window.
  await prisma.webhookEvent.update({
    where: { id: row.id },
    data: { receivedAt: opts.receivedAt },
  });
  return row.id;
}

describe('Webhook receiver reliability (fix/webhook-receiver-reliability)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
    process.env['WEBHOOK_INTAKE_INLINE'] = 'true';
  });

  beforeEach(async () => {
    _resetRateLimitStoreForTests();
    _resetWebhookAuthFailuresForTests();
    await truncateAll();
    await ensureFeeDefinitions();
  });

  afterAll(() => {
    _resetRateLimitStoreForTests();
    _resetWebhookAuthFailuresForTests();
    delete process.env['WEBHOOK_INTAKE_INLINE'];
  });

  it('(a) Zod-invalid payload (lines missing) → 200 + no webhook_events row', async () => {
    const { storeId } = await setupStore();
    const { lines: _omitLines, ...noLines } = makeWebhookPayload();
    void _omitLines;
    const res = await postWebhook(
      storeId,
      JSON.stringify(noLines),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(0);
  });

  it('(a2) sparse line (no lineUnitPrice/lineGrossAmount/vatRate) → 200 + estimate-incomplete order', async () => {
    const { storeId } = await setupStore();
    // The Trendyol STAGE test-order webhook ships lines WITHOUT the financial
    // fields; sellerId + quantity are present (they stay required). Previously
    // this Zod-failed → silent 200-drop with zero rows. Now the schema tolerates
    // it and the calculable-barcode order is intaken as an estimate. The payload
    // still carries package-level totals (packageTotalPrice/packageGrossAmount =
    // 120), so the ORDER header saleGross is 120 (header-derived) — but the LINE
    // money is sparse: lineGrossAmount ?? 0 → zero commission base → commissionGross 0.
    const sparse = makeWebhookPayload({
      lines: [
        {
          lineId: 1,
          sellerId: Number.parseInt(SUPPLIER_ID, 10),
          barcode: BARCODE,
          quantity: 1,
          commission: 10,
        },
      ],
    });
    const res = await postWebhook(
      storeId,
      JSON.stringify(sparse),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);

    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).not.toBeNull();

    const order = await prisma.order.findFirstOrThrow({
      where: { storeId },
      include: { items: true },
    });
    // Header total comes from packageTotalPrice (present), NOT from the sparse line.
    expect(order.saleGross?.toNumber()).toBe(120);
    // Sparse line → lineGrossAmount ?? 0 → zero list gross → zero commission estimate.
    expect(order.items).toHaveLength(1);
    const [item] = order.items;
    expect(item?.lineListGross.toNumber()).toBe(0);
    expect(item?.commissionGross.toNumber()).toBe(0);
    expect(item?.estimatedCommissionGross?.toNumber()).toBe(0);
  });

  it('(a2b) sparse line AND no package totals → zero-revenue order intakes with no Decimal crash', async () => {
    const { storeId } = await setupStore();
    // Extreme sparse: the line omits money AND the payload omits the package
    // totals, so every money term resolves through `?? 0`. This proves the
    // all-zero path is safe end to end — no `new Decimal(undefined)` throw
    // anywhere in the mapper → upsert → estimate chain. A throw would surface
    // either as a non-200 (transient/intake) or as a terminal processingError
    // (deterministic mapper defect) with no order row, so asserting 200 + an
    // order row + a null processingError is complete proof of a clean intake.
    const {
      packageTotalPrice: _pt,
      packageGrossAmount: _pg,
      ...zeroRevenue
    } = makeWebhookPayload({
      lines: [
        {
          lineId: 1,
          sellerId: Number.parseInt(SUPPLIER_ID, 10),
          barcode: BARCODE,
          quantity: 1,
        },
      ],
    });
    void _pt;
    void _pg;
    const res = await postWebhook(
      storeId,
      JSON.stringify(zeroRevenue),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);

    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).not.toBeNull();
    expect(event.processingError).toBeNull();

    const order = await prisma.order.findFirstOrThrow({ where: { storeId } });
    expect(order.saleGross?.toNumber()).toBe(0);
  });

  it('(a3) line missing required sellerId/quantity → 200 drop + no webhook_events row', async () => {
    const { storeId } = await setupStore();
    // sellerId and quantity remain REQUIRED after the sparse-tolerance change,
    // so a line missing them is still a Zod failure → deterministic 200-drop
    // with no row (unlike (a2), which only drops the optional money fields).
    const invalid = makeWebhookPayload({
      lines: [
        {
          lineId: 1,
          barcode: BARCODE,
          lineUnitPrice: 120,
          lineGrossAmount: 120,
          vatRate: 20,
          commission: 10,
        },
      ],
    });
    const res = await postWebhook(
      storeId,
      JSON.stringify(invalid),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(0);
  });

  it('(b) supplier mismatch → 200 + no webhook_events row', async () => {
    const { storeId } = await setupStore();
    const res = await postWebhook(
      storeId,
      JSON.stringify(makeWebhookPayload({ supplierId: 12321 })),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(0);
  });

  it('(c) re-delivery of a processed event → 200 + single row (existing dedup)', async () => {
    const { storeId } = await setupStore();
    const auth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);
    const body = JSON.stringify(makeWebhookPayload());

    const first = await postWebhook(storeId, body, auth);
    expect(first.status).toBe(200);
    const second = await postWebhook(storeId, body, auth);
    expect(second.status).toBe(200);

    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(1);
    expect(await prisma.order.count({ where: { storeId } })).toBe(1);
  });

  it('(d) re-delivery of a fresh unprocessed row → 200, intake NOT re-run (consumer owns it)', async () => {
    const { orgId, storeId } = await setupStore();
    await seedWebhookEvent(orgId, storeId, { processedAt: null, receivedAt: new Date() });

    const res = await postWebhook(
      storeId,
      JSON.stringify(makeWebhookPayload()),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);

    // No order was created; the unprocessed row's lease owner (an in-request
    // claim or the consumer tick) is the sole processor, not this re-delivery.
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).toBeNull();
  });

  it('(e) re-delivery of an OLD unprocessed row → 200, still NOT reprocessed (contract change: consumer owns unprocessed rows)', async () => {
    // Behaviour change from the retired 2-minute stale-reprocess branch: an
    // unprocessed row is NEVER reprocessed on a re-delivery, no matter how old.
    // A second writer under Read Committed could double-insert order items, so
    // the lease mechanism (consumer tick) is the sole owner — the re-delivery
    // just acknowledges with 200.
    const { orgId, storeId } = await setupStore();
    const staleReceivedAt = new Date(Date.now() - 60 * 60_000);
    const eventId = await seedWebhookEvent(orgId, storeId, {
      processedAt: null,
      receivedAt: staleReceivedAt,
    });

    const res = await postWebhook(
      storeId,
      JSON.stringify(makeWebhookPayload()),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);

    // The row stays unprocessed and no order is created — the re-delivery is a
    // no-op; the consumer tick (unexercised here) is what will eventually drive it.
    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.processedAt).toBeNull();
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
  });

  it('(f) non-UUID storeId → 404 (guarded before Prisma, no 500)', async () => {
    await setupStore();
    const res = await postWebhook(
      'not-a-uuid',
      JSON.stringify(makeWebhookPayload()),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(404);
  });

  it('(g) malformed JSON body → 200 (deterministic drop, no retry loop)', async () => {
    const { storeId } = await setupStore();
    const res = await postWebhook(
      storeId,
      '{ this is not valid json',
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(0);
  });

  it('(h) sustained bad-auth outage (count + duration) nulls the stale secret → next request 404', async () => {
    const { storeId } = await setupStore();
    const wrongAuth = basicAuthHeader(WEBHOOK_USER, 'W'.repeat(43));

    // Count alone (a burst) must NOT trigger self-heal: the duration test is
    // unmet, so an attacker cannot force a rotation in seconds.
    for (let i = 0; i < WEBHOOK_AUTH_FAIL_MIN_COUNT; i += 1) {
      const res = await postWebhook(storeId, JSON.stringify(makeWebhookPayload()), wrongAuth);
      expect(res.status).toBe(401);
    }
    const beforeBackdate = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(beforeBackdate.webhookSecret).not.toBeNull();

    // Shift the window into the past so the failures now span the required
    // duration (the sustained-outage signature real Trendyol retries produce).
    _backdateWebhookAuthFailureForTests(storeId, WEBHOOK_AUTH_FAIL_MIN_DURATION_MS);

    // One more failure now satisfies BOTH count and duration → self-heal fires.
    const healing = await postWebhook(storeId, JSON.stringify(makeWebhookPayload()), wrongAuth);
    expect(healing.status).toBe(401);

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.webhookSecret).toBeNull();

    // With the secret null the webhook reads as disabled → 404 (non-disclosure).
    const after = await postWebhook(
      storeId,
      JSON.stringify(makeWebhookPayload()),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(after.status).toBe(404);
  });

  it('(h2) a successful auth clears the failure window, so a later burst never heals', async () => {
    const { storeId } = await setupStore();
    const wrongAuth = basicAuthHeader(WEBHOOK_USER, 'W'.repeat(43));
    const rightAuth = basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS);

    // Accumulate the count, then authenticate successfully (reset-on-success).
    for (let i = 0; i < WEBHOOK_AUTH_FAIL_MIN_COUNT; i += 1) {
      const res = await postWebhook(storeId, JSON.stringify(makeWebhookPayload()), wrongAuth);
      expect(res.status).toBe(401);
    }
    const ok = await postWebhook(storeId, JSON.stringify(makeWebhookPayload()), rightAuth);
    expect(ok.status).toBe(200);

    // The entry is gone, so backdating is a no-op and a single fresh failure
    // starts a brand-new window: count/duration unmet → secret stays intact.
    _backdateWebhookAuthFailureForTests(storeId, WEBHOOK_AUTH_FAIL_MIN_DURATION_MS);
    const after = await postWebhook(storeId, JSON.stringify(makeWebhookPayload()), wrongAuth);
    expect(after.status).toBe(401);

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.webhookSecret).not.toBeNull();
  });

  it('(i) body larger than 1 MB → 200 (dropped by body limit)', async () => {
    const { storeId } = await setupStore();
    const huge = JSON.stringify({ ...makeWebhookPayload(), padding: 'x'.repeat(1_100_000) });
    const res = await postWebhook(storeId, huge, basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS));
    expect(res.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { storeId } })).toBe(0);
  });

  it('(j) payload that passes Zod but crashes the mapper → 200 + event marked terminal', async () => {
    const { storeId } = await setupStore();
    // A poisoned `discountDetails[].lineItemPrice` passes the receiver's Zod
    // schema (which validates the load-bearing scalar fields + passthrough) but
    // makes the deep mapper's `new Decimal('not-a-number')` throw. That is a
    // deterministic payload defect: the service marks the event terminal
    // (processedAt + processingError) and returns, so the route replies 200.
    const poisoned = makeWebhookPayload({
      lines: [
        {
          lineId: 1,
          sellerId: Number.parseInt(SUPPLIER_ID, 10),
          barcode: BARCODE,
          quantity: 1,
          lineUnitPrice: 120,
          lineGrossAmount: 120,
          lineSellerDiscount: 0,
          vatRate: 20,
          commission: 10,
          discountDetails: [
            { lineItemPrice: 'not-a-number', lineItemSellerDiscount: 0, lineItemTyDiscount: 0 },
          ],
        },
      ],
    });
    const res = await postWebhook(
      storeId,
      JSON.stringify(poisoned),
      basicAuthHeader(WEBHOOK_USER, WEBHOOK_PASS),
    );
    expect(res.status).toBe(200);

    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { storeId } });
    expect(event.processedAt).not.toBeNull();
    expect(event.processingError).not.toBeNull();
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
  });
});
