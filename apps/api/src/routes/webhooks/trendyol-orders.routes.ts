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
 * Retry-model contract (webhook-model.md "Webhook Önemli Notlar"): Trendyol
 * replays EVERY failed request (4xx included) every 5 minutes until it succeeds,
 * then flips a permanently-failing webhook to PASSIVE. That makes the response
 * code a control signal, not just a status:
 *   - 200 → CLOSE the event. Used for both success AND deterministic dead-ends
 *     (bad auth already passed, malformed body, unknown status, payload defect,
 *     supplier mismatch) — retrying those never changes the outcome.
 *   - 5xx → KEEP the event open so Trendyol's retry becomes our replay engine
 *     for TRANSIENT faults (DB down, fee seed missing, intake exception).
 *   - 401 / 404 (verify middleware) stay in the normal flow: a stale secret's
 *     401s drive Trendyol to PASSIVE, which the reconciler prunes + re-registers
 *     — the intended heal path.
 *
 * Request hardening (before auth): a 1 MB body limit and a per-store rate limit
 * both fail SAFE (drop with 200 / 429) so a malformed or flooding caller cannot
 * wedge the receiver.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';
import { Prisma, type Store } from '@pazarsync/db';
import type { TrendyolShipmentPackage } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';

import { RATE_LIMITS } from '../../config/rate-limits';
import { createSubApp } from '../../lib/create-hono-app';
import { problemDetailsResponse } from '../../lib/problem-details';
import { rateLimit } from '../../middleware/rate-limit.middleware';
import { verifyTrendyolWebhookMiddleware } from '../../middleware/verify-trendyol-webhook.middleware';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { processTrendyolWebhookEvent } from '../../services/webhooks/trendyol-webhook-intake.service';

type WebhookEnv = { Variables: { store: Store } };

/** Max webhook body Trendyol should ever send us; larger = malformed/hostile. */
const WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * A de-duped WebhookEvent row whose `processedAt` is still null AND whose
 * `receivedAt` is older than this window is treated as a failed prior attempt
 * and REPROCESSED on the current re-delivery (Trendyol's retry as replay).
 * Younger unprocessed rows are assumed in-flight (a concurrent first attempt)
 * and left alone to avoid double processing. Exported for tests.
 */
export const STALE_REPROCESS_THRESHOLD_MS = 2 * 60_000;

// Webhook payload schema — minimal runtime validation. Full
// `TrendyolShipmentPackage` shape stays as a TS type; here we assert the
// fields the receiver actually consumes so a malformed payload short-circuits
// (via the sub-app defaultHook → logged 200) before reaching the intake path.
// Contract: docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/webhook/webhook-model.md.
// supplierId optional + lines[].sellerId required: Trendyol prod webhook
// payload ships root-level `supplierId`, but the stage test order endpoint omits
// it. Per-line `sellerId` is present in both envs (authoritative seller scope).
//
// lineUnitPrice + lineGrossAmount + vatRate optional: the mapper already
// tolerates their absence (`?? 0`, logged as `orders.sparse-line`), so the
// receiver must not be stricter than the mapper it feeds. Sparseness is a
// Trendyol STAGE test-order artifact — PROD webhooks always ship full pricing.
// Accepting a sparse payload as an estimate-incomplete order is strictly better
// than the previous silent 200-drop, which wrote no row and killed the
// webhook's real-time path (intake + toast + live performance) entirely.
//
// IMPORTANT: a sparse order's estimate money is WRITE-ONCE at create — a later
// sync does NOT heal it (upsert-order.ts updates only status/delivery/cargo/
// watermark; OrderItem lines are insert-skip-if-exists). Only settlement
// reconciliation writes the real settled values. Stage orders with an
// uncatalogued barcode route to the cost-missing BUFFER, whose snapshot IS
// refreshed before promotion, so they self-heal there; a sparse order for a
// calculable (cost-known) product would freeze its zero estimate money until
// settlement (rare — prod ships full pricing).
//
// sellerId + quantity stay REQUIRED: sellerId is the authoritative seller-scope
// guard and quantity is load-bearing for a meaningful order (stage payloads
// carry both).
const TrendyolWebhookLineSchema = z
  .object({
    sellerId: z.number().int().positive('LINE_SELLER_ID_REQUIRED'),
    quantity: z.number().int().positive('LINE_QUANTITY_REQUIRED'),
    lineUnitPrice: z.number().nonnegative('LINE_UNIT_PRICE_REQUIRED').optional(),
    lineGrossAmount: z.number().nonnegative('LINE_GROSS_AMOUNT_REQUIRED').optional(),
    vatRate: z.number().nonnegative('LINE_VAT_RATE_REQUIRED').optional(),
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

/**
 * Webhook-specific validation hook. A Zod failure here means Trendyol sent a
 * body we cannot process; a 422 would loop Trendyol's infinite retry forever,
 * so we log the issue codes (never the payload — PII) and CLOSE the event with
 * a 200 instead.
 */
function webhookValidationHook(
  result: { success: boolean; error?: { issues: Array<{ message: string }> } },
  c: Context,
): Response | undefined {
  if (!result.success && result.error !== undefined) {
    const issues = result.error.issues.map((issue) => issue.message);
    syncLog.error('webhook.payload-invalid', {
      storeId: c.req.param('storeId'),
      issues,
    });
    return c.body(null, 200);
  }
  return undefined;
}

const webhookApp = createSubApp<WebhookEnv>({ defaultHook: webhookValidationHook });

// Convert a thrown error to a message string for the `processingError` column,
// without leaking a stack. Used by both the fresh and reprocess catch sites.
async function markProcessingError(webhookEventId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  syncLog.error('webhook.process-failed', { webhookEventId, error: message });
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processingError: message },
  });
}

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
    'Deterministic failures (malformed body, unknown status, supplier mismatch) ' +
    'return 200 so Trendyol stops retrying; transient failures return 5xx so it ' +
    'replays. Mounted BEFORE the global Bearer JWT auth middleware.',
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
      description: 'Event accepted (processed, deduped, or deterministically dropped)',
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Webhook auth failed',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Store not found or webhook disabled',
    },
    429: Common429Response,
  },
});

// Request hardening + auth, in order, BEFORE the handler:
//   1. bodyLimit — cap the payload; oversize drops with 200 (no retry loop).
//   2. rateLimit — per-store bucket (webhook callers are not authenticated
//      users, so a keyResolver derives identity from the storeId path param,
//      falling back to the forwarded client IP). Overflow → 429 (transient for
//      Trendyol; it retries in 5 minutes).
//   3. verifyTrendyolWebhookMiddleware — store-scoped Basic Auth.
const routingPath = trendyolOrderWebhookRoute.getRoutingPath();
webhookApp.use(
  routingPath,
  bodyLimit({
    maxSize: WEBHOOK_BODY_LIMIT_BYTES,
    onError: (c) => {
      // Deliberate tradeoff: a genuine >1 MB event is PERMANENTLY dropped here
      // (we reply 200 so it is not retried). A Trendyol order webhook never
      // legitimately approaches 1 MB, so the alternative — letting an oversize
      // body through, or 4xx-ing it into Trendyol's infinite 5-minute retry
      // loop — is worse than losing the pathological outlier.
      syncLog.warn('webhook.body-too-large', { path: c.req.path });
      return c.body(null, 200);
    },
  }),
);
webhookApp.use(
  routingPath,
  rateLimit({
    ...RATE_LIMITS.WEBHOOK,
    keyResolver: (c) => c.req.param('storeId') ?? c.req.header('x-forwarded-for') ?? 'unknown',
  }),
);
webhookApp.use(routingPath, verifyTrendyolWebhookMiddleware);

webhookApp.openapi(trendyolOrderWebhookRoute, async (c) => {
  const store = c.get('store');
  // Zod validates the load-bearing fields; the rest pass through unchecked
  // (Trendyol payload has 30+ fields that we just forward to the mapper).
  const payload = c.req.valid('json') as unknown as TrendyolShipmentPackage;

  // ─── 0. PRODUCTION-only intake gate (defense-in-depth) ─────────────────
  // The `connect` path already blocks SANDBOX store creation in production
  // via the ALLOW_SANDBOX_CONNECTIONS env flag (services/store.service.ts).
  // This is the receiver-side mirror: if a SANDBOX store ever ends up in a
  // production deployment, drop the webhook silently with 200 OK so prod data
  // sets stay clean of test orders. Non-production environments still intake
  // SANDBOX webhooks normally so stage runbooks keep working.
  if (process.env['NODE_ENV'] === 'production' && store.environment === 'SANDBOX') {
    syncLog.info('webhook.sandbox-dropped-in-production', {
      storeId: store.id,
      platformOrderId: String(payload.shipmentPackageId),
    });
    return c.body(null, 200);
  }

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
    // Deterministic drop: the caller authenticated as this store, but the body
    // names a different seller. Retrying the same body never helps, so CLOSE
    // the event with 200 (identity was already proven at the auth layer).
    syncLog.error('webhook.supplier-mismatch', {
      storeId: store.id,
      payloadSupplierIds: Array.from(payloadSupplierIds),
      storeSupplierId: store.externalAccountId,
    });
    return c.body(null, 200);
  }

  const platformOrderId = String(payload.shipmentPackageId);
  const platformStatus = payload.status;
  const lastModifiedDate = new Date(payload.lastModifiedDate);

  // ─── 2. Idempotency log INSERT (P2002 = re-delivery) ───────────────────
  let created: { id: string };
  try {
    created = await prisma.webhookEvent.create({
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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return handleReDelivery(c, store, payload, {
        platformOrderId,
        platformStatus,
        lastModifiedDate,
      });
    }
    throw err;
  }

  // ─── 3. Fresh event: process, then close with 200 ──────────────────────
  try {
    await processTrendyolWebhookEvent(store, payload, created.id);
  } catch (err) {
    // Transient fault — record it and rethrow so Trendyol replays in ~5 min.
    await markProcessingError(created.id, err);
    throw err;
  }
  return c.body(null, 200);
});

/**
 * P2002 re-delivery decision tree. The composite idempotency key already
 * exists, so we look up the prior row and decide whether this delivery is a
 * true duplicate (drop), a concurrent in-flight first attempt (drop), or a
 * failed prior attempt worth reprocessing (Trendyol's retry as replay).
 */
async function handleReDelivery(
  c: Context<WebhookEnv>,
  store: Store,
  payload: TrendyolShipmentPackage,
  key: { platformOrderId: string; platformStatus: string; lastModifiedDate: Date },
): Promise<Response> {
  const existing = await prisma.webhookEvent.findUnique({
    where: {
      webhook_event_idempotency_key: {
        storeId: store.id,
        platformOrderId: key.platformOrderId,
        platformStatus: key.platformStatus,
        platformLastModifiedDate: key.lastModifiedDate,
      },
    },
    select: { id: true, processedAt: true, receivedAt: true },
  });

  // Row vanished between the P2002 and this read (extremely unlikely) — nothing
  // to reprocess; treat as handled.
  if (existing === null || existing.processedAt !== null) {
    syncLog.info('webhook.deduped', {
      storeId: store.id,
      platformOrderId: key.platformOrderId,
      platformStatus: key.platformStatus,
      lastModifiedDate: key.lastModifiedDate.toISOString(),
    });
    return c.body(null, 200);
  }

  const age = Date.now() - existing.receivedAt.getTime();
  if (age < STALE_REPROCESS_THRESHOLD_MS) {
    // A first attempt received moments ago may still be running — do NOT
    // double-process. Trendyol will retry again if that attempt fails.
    syncLog.info('webhook.dedup-inflight', {
      storeId: store.id,
      platformOrderId: key.platformOrderId,
    });
    return c.body(null, 200);
  }

  // Unprocessed AND stale → the prior attempt failed. Reprocess on this
  // re-delivery, using the row we already have. If two stale re-deliveries race
  // here, double reprocessing is TOLERATED and harmless: intakeOrder is
  // idempotent (upsert on the composite order key) and the RETURNED → CLAIMS
  // acquireSlot dedupes via SyncInProgressError — so a concurrent replay
  // converges to the same single order + single CLAIMS slot.
  syncLog.warn('webhook.reprocessing-failed-event', {
    storeId: store.id,
    platformOrderId: key.platformOrderId,
    webhookEventId: existing.id,
  });
  try {
    await processTrendyolWebhookEvent(store, payload, existing.id);
  } catch (err) {
    await markProcessingError(existing.id, err);
    throw err;
  }
  return c.body(null, 200);
}

// Sub-app error handler. Two lanes:
//   1. A Hono-native 4xx HTTPException (e.g. a malformed-JSON body parse that
//      throws before the handler) is a deterministic client fault — log it and
//      CLOSE the event with 200 so Trendyol stops retrying a broken body.
//   2. Everything else (domain errors, transient 5xx) flows through the shared
//      RFC 7807 mapper — same behaviour as the global app.onError, so 401/404
//      (stale-secret heal path) and 429 (rate limit) reach Trendyol verbatim.
webhookApp.onError((err, c) => {
  if (err instanceof HTTPException && err.status >= 400 && err.status < 500) {
    syncLog.error('webhook.request-malformed', { path: c.req.path, status: err.status });
    return c.body(null, 200);
  }
  return problemDetailsResponse(err, c);
});

export default webhookApp;
