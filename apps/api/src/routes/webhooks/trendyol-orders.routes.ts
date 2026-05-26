/**
 * Trendyol orders webhook receiver — POST /v1/webhooks/orders/:storeId
 *
 * Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §6
 *
 * Mount sequence (apps/api/src/app.ts):
 *   1. Public routes (health, docs) — BEFORE authMiddleware
 *   2. Webhook routes (this module) — BEFORE authMiddleware
 *      → user JWT auth bypassed; verify-trendyol-webhook middleware enforces
 *        store-scoped Basic Auth instead.
 *   3. authMiddleware
 *   4. Protected routes
 *
 * Flow:
 *   1. verify-trendyol-webhook middleware → store + creds validated, c.set('store')
 *   2. Defense-in-depth: payload.supplierId === store.externalAccountId
 *   3. WebhookEvent INSERT — composite unique key catches P2002 → dedupe 200 OK
 *   4. Status mapping (mapTrendyolStatusToEnum):
 *      - null  → log warn + skip upsert + still 200 (forward-compat unknown)
 *      - !null → continue
 *   5. createdBy === 'transfer' → override status to CANCELLED (Trendyol
 *      forwarded the package to another seller; we lose it)
 *   6. Build MappedOrder + upsertOrderWithSnapshot dispatch (same path as sync)
 *   7. WebhookEvent.processedAt set
 *   8. 200 OK
 *
 * Error responses:
 *   - 401 (auth) — Trendyol does not retry; permanent failure
 *   - 404 (store/disabled) — same as above
 *   - 400 (malformed payload) — log + 400; Trendyol does not retry
 *   - 5xx — processing exception; Trendyol retries every 5 minutes
 */

import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';
import { Prisma, type Store } from '@pazarsync/db';
import {
  mapTrendyolStatusToEnum,
  type MappedOrder,
  type TrendyolShipmentPackage,
} from '@pazarsync/marketplace';
import { upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import { buildCalcCheckLines, resolveOrderCalculability } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import { UnauthorizedError, ValidationError } from '../../lib/errors';
import { createSubApp } from '../../lib/create-hono-app';
import { ProblemDetailsSchema } from '../../openapi/error-schemas';
import { verifyTrendyolWebhookMiddleware } from '../../middleware/verify-trendyol-webhook.middleware';

import { mapTrendyolWebhookPayload } from './trendyol-orders.mapper';

type WebhookEnv = { Variables: { store: Store } };

// Webhook payload schema — minimal runtime validation. Full
// `TrendyolShipmentPackage` shape stays as a TS type; here we assert the
// fields the receiver actually consumes so a malformed payload short-circuits
// before reaching the upsert path. Trendyol's contract is documented in
// docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/webhook/webhook-model.md.
// supplierId optional + lines[].sellerId required: Trendyol prod webhook
// payload (webhook-model.md) ships root-level `supplierId`, but stage test
// order endpoint omits it. Per-line `sellerId` is present in both envs
// (it is the authoritative seller scope per Trendyol API contract).
//
// lineUnitPrice + lineGrossAmount required: the mapper reads them for KDV
// split + commission calc. Stage test orders ship sparse payloads without
// these — that case returns 422 here (cleaner than a deep-mapper crash);
// real prod orders always carry both fields per webhook-model.md §lines.
const TrendyolWebhookLineSchema = z
  .object({
    sellerId: z.number().int().positive('LINE_SELLER_ID_REQUIRED'),
    quantity: z.number().int().positive('LINE_QUANTITY_REQUIRED'),
    lineUnitPrice: z.number().nonnegative('LINE_UNIT_PRICE_REQUIRED'),
    lineGrossAmount: z.number().nonnegative('LINE_GROSS_AMOUNT_REQUIRED'),
    vatRate: z.number().nonnegative('LINE_VAT_RATE_REQUIRED'),
  })
  .passthrough();

const TrendyolWebhookPayloadSchema = z
  .object({
    shipmentPackageId: z.number().int().positive('SHIPMENT_PACKAGE_ID_REQUIRED'),
    orderNumber: z.string().min(1, 'ORDER_NUMBER_REQUIRED'),
    status: z.string().min(1, 'STATUS_REQUIRED'),
    orderDate: z.number().int().positive('ORDER_DATE_REQUIRED'),
    lastModifiedDate: z.number().int().positive('LAST_MODIFIED_DATE_REQUIRED'),
    supplierId: z.number().int().positive('SUPPLIER_ID_REQUIRED').optional(),
    lines: z.array(TrendyolWebhookLineSchema).min(1, 'LINES_REQUIRED'),
  })
  .passthrough();

const webhookApp = createSubApp<WebhookEnv>();

const trendyolOrderWebhookRoute = createRoute({
  method: 'post',
  // Path is RELATIVE — `createApp()` mounts this sub-app under basePath('/v1'),
  // so the final wire path is `/v1/webhooks/orders/:storeId`. Adding `/v1`
  // here would produce `/v1/v1/webhooks/...`.
  path: '/webhooks/orders/{storeId}',
  tags: ['Webhooks'],
  summary: 'Receive a Trendyol order status webhook',
  description:
    'Per-store webhook callback. Authenticated via store-scoped Basic Auth ' +
    '(`Authorization: Basic <base64(user:pass)>`); HMAC not supported by ' +
    'Trendyol. Idempotent: composite key (storeId, platformOrderId, status, ' +
    'lastModifiedDate) catches re-deliveries within the 5-minute retry window. ' +
    'Mounted BEFORE the global Bearer JWT auth middleware.',
  request: {
    params: z.object({ storeId: z.string().uuid('INVALID_STORE_ID') }),
    body: {
      content: {
        'application/json': {
          schema: TrendyolWebhookPayloadSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event accepted (processed or deduped)',
    },
    400: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Malformed payload',
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Webhook auth failed',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Store not found or webhook disabled',
    },
  },
});

webhookApp.use(trendyolOrderWebhookRoute.getRoutingPath(), verifyTrendyolWebhookMiddleware);

webhookApp.openapi(trendyolOrderWebhookRoute, async (c) => {
  const store = c.get('store');
  // Zod validates the load-bearing fields; the rest pass through unchecked
  // (Trendyol payload has 30+ fields that we just forward to the mapper).
  const payload = c.req.valid('json') as unknown as TrendyolShipmentPackage;

  // ─── 1. Defense-in-depth: payload supplier must match store ────────────
  // Root `supplierId` is the prod contract (webhook-model.md). Stage payloads
  // omit it; lines[].sellerId is the always-present fallback. We collect every
  // candidate seller id and require it to be a single value equal to the store.
  const storeSupplierId = Number.parseInt(store.externalAccountId, 10);
  const payloadSupplierIds = new Set<number>();
  if (typeof payload.supplierId === 'number') {
    payloadSupplierIds.add(payload.supplierId);
  }
  for (const line of payload.lines) {
    // Zod schema enforces line.sellerId is a positive integer; the
    // `TrendyolShipmentPackage` cast erases that narrowing, so we re-guard
    // here to keep `payloadSupplierIds` strictly typed.
    if (typeof line.sellerId === 'number') {
      payloadSupplierIds.add(line.sellerId);
    }
  }
  const isSingleMatch =
    Number.isFinite(storeSupplierId) &&
    payloadSupplierIds.size === 1 &&
    payloadSupplierIds.has(storeSupplierId);
  if (!isSingleMatch) {
    syncLog.error('webhook.supplier-mismatch', {
      storeId: store.id,
      payloadSupplierIds: Array.from(payloadSupplierIds),
      storeSupplierId: store.externalAccountId,
    });
    throw new UnauthorizedError('Supplier ID mismatch');
  }

  // ─── 2. Idempotency log INSERT (P2002 = re-delivery dedupe) ────────────
  const platformOrderId = String(payload.shipmentPackageId);
  const platformStatus = payload.status;
  const lastModifiedDate = new Date(payload.lastModifiedDate);

  let webhookEventId: string;
  try {
    const created = await prisma.webhookEvent.create({
      data: {
        organizationId: store.organizationId,
        storeId: store.id,
        platform: 'TRENDYOL',
        platformOrderId,
        platformStatus,
        platformLastModifiedDate: lastModifiedDate,
        rawPayload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    webhookEventId = created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      syncLog.info('webhook.deduped', {
        storeId: store.id,
        platformOrderId,
        platformStatus,
        lastModifiedDate: lastModifiedDate.toISOString(),
      });
      return c.body(null, 200);
    }
    throw err;
  }

  // ─── 3. Status mapping (forward-compat fallback) ───────────────────────
  const mappedStatus = mapTrendyolStatusToEnum(platformStatus);
  if (mappedStatus === null) {
    syncLog.warn('webhook.unknown-status', {
      storeId: store.id,
      platformOrderId,
      rawStatus: platformStatus,
    });
    // Order.status DOKUNULMAZ — event log yazıldı, dispatch atlanır, 200 OK.
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date() },
    });
    return c.body(null, 200);
  }

  // ─── 4. Build MappedOrder + dispatch ───────────────────────────────────
  let mapped: MappedOrder;
  try {
    mapped = mapTrendyolWebhookPayload(payload, mappedStatus);
  } catch (err) {
    syncLog.error('webhook.payload-map-failed', {
      storeId: store.id,
      platformOrderId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new ValidationError([{ field: '(payload)', code: 'PAYLOAD_MAPPING_FAILED' }]);
  }

  // ─── Calculability gate — V1 hard skip (PR-B 2026-05-24) ───────────────
  // An order with any line missing a resolved variant or a cost snapshot is
  // never written; we still mark the webhook event processed (we handled it).
  const calcLines = await buildCalcCheckLines(prisma, {
    storeId: store.id,
    lines: mapped.lines,
  });
  const calc = resolveOrderCalculability(calcLines);
  if (calc.kind === 'skip') {
    syncLog.info('orders.skipped', {
      source: 'webhook',
      reason: calc.reason,
      storeId: store.id,
      platformOrderId,
      barcode: calc.barcode,
      ...(calc.reason === 'cost_missing' ? { variantId: calc.variantId } : {}),
    });
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date() },
    });
    return c.body(null, 200);
  }

  try {
    await upsertOrderWithSnapshot(store.id, store.organizationId, mapped);
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date() },
    });
    return c.body(null, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    syncLog.error('webhook.process-failed', {
      storeId: store.id,
      platformOrderId,
      error: message,
    });
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processingError: message },
    });
    // Re-throw → 500 → Trendyol retries every 5 minutes per webhook-model.md
    throw err;
  }
});

export default webhookApp;
