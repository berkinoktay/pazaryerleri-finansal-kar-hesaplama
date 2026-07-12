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
 * Retry-model contract (webhook-model.md "Webhook Önemli Notlar" + design
 * 2026-07-11 Paket D): Trendyol replays EVERY failed request (4xx included)
 * every 5 minutes until it succeeds, then flips a permanently-failing webhook to
 * PASSIVE. Historically this route USED that retry as its replay engine (a 5xx
 * on a transient fault). It no longer does: the durable `webhook_events` queue
 * plus the sync-worker consumer tick ARE the replay engine now, so the route
 * almost always answers 200 and Trendyol never drives a healthy store to PASSIVE.
 *   - 200 → the event is safely on the queue (persisted). Covers success,
 *     deterministic dead-ends (bad body, unknown status, payload defect,
 *     supplier mismatch — retrying never helps), AND a transient processing
 *     fault: the row is left unprocessed with a backoff, and a later consumer
 *     tick (or a re-delivery) replays it. Trendyol-as-replay-engine is retired.
 *   - 5xx → only a genuine infrastructure failure BEFORE the row is persisted
 *     (e.g. the idempotency INSERT itself throws) still bubbles out as 5xx.
 *   - 401 / 404 (verify middleware) stay in the normal flow: a stale secret's
 *     401s drive Trendyol to PASSIVE, which the reconciler prunes + re-registers
 *     — the intended heal path. 429 (rate limit) and the oversize / sandbox /
 *     supplier-mismatch 200-drops are unchanged.
 *
 * Two ingest modes (design §D6, permanent cutover #460):
 *   - default (STANDARD) → persist the row and return 200 immediately, leaving it
 *     unleased; the sync-worker consumer tick claims the fresh row within ~5s (~1s
 *     measured live). The API process does no processing/vendor work — webhook
 *     order processing now depends on the sync-worker running (the durable queue
 *     holds events until it is).
 *   - inline escape hatch (`WEBHOOK_INTAKE_INLINE='true'`) → persist the row, WIN
 *     a processing lease, and process it in-request with `catalogRepair:
 *     'deferred'` (zero vendor calls in the request path; the 60s
 *     variant-resolution tick is the backstop). ONLY for the rare stretch the
 *     sync-worker is down; off by default.
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
import {
  claimWebhookEventLease,
  recordTransientProcessingFailure,
  TrendyolWebhookPayloadSchema,
} from '@pazarsync/webhook-ingest';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';

import { RATE_LIMITS } from '../../config/rate-limits';
import { createSubApp } from '../../lib/create-hono-app';
import { problemDetailsResponse } from '../../lib/problem-details';
import { isWebhookIntakeInline } from '../../lib/webhook-intake-mode';
import { rateLimit } from '../../middleware/rate-limit.middleware';
import { verifyTrendyolWebhookMiddleware } from '../../middleware/verify-trendyol-webhook.middleware';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { processTrendyolWebhookEvent } from '../../services/webhooks/trendyol-webhook-intake.service';

type WebhookEnv = { Variables: { store: Store } };

/** Max webhook body Trendyol should ever send us; larger = malformed/hostile. */
const WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;

// The webhook payload schema now lives in `@pazarsync/webhook-ingest`
// (payload-schema.ts) so the route and the sync-worker consumer tick validate
// against ONE shape; it is imported above. Full field-level rationale lives with
// the schema definition.

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
    'The event is persisted to a durable queue and processed either in-request ' +
    'or by the sync-worker consumer tick; deterministic failures AND transient ' +
    'processing faults both return 200 (the queue + consumer are the replay ' +
    "engine, not Trendyol's retry). Mounted BEFORE the global Bearer JWT auth " +
    'middleware.',
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
      return handleReDelivery(c, store, {
        platformOrderId,
        platformStatus,
        lastModifiedDate,
      });
    }
    throw err;
  }

  // ─── 3. Fresh event: defer to the consumer tick (default) or, only under the
  //        emergency inline escape hatch, process it in-request ───────────────
  // Deferred is the STANDARD path (design §D6, permanent cutover #460): the row
  // is persisted and left unleased, so return 200 right away and let the
  // sync-worker consumer tick claim it (<=5s; ~1s measured live). No lease, no
  // processing here — the tick's prefilter (processed_at IS NULL AND
  // next_process_at eligible) picks the fresh row up on its next pass. This keeps
  // the API process free of processing/vendor work.
  if (!isWebhookIntakeInline()) {
    return c.body(null, 200);
  }

  // Inline escape hatch (WEBHOOK_INTAKE_INLINE='true'): restore in-request
  // processing for the rare stretch the sync-worker is down. Win the processing
  // lease before touching the row so the consumer tick can never double-process
  // it. A false here means the tick grabbed the fresh row first (a theoretical
  // race in the sub-second window) — it now owns processing, so we close with 200.
  const leased = await claimWebhookEventLease(prisma, created.id);
  if (!leased) {
    return c.body(null, 200);
  }

  try {
    // `catalogRepair: 'deferred'` (D5): the request makes ZERO vendor calls; the
    // 60s variant-resolution tick backstops any uncatalogued barcode.
    await processTrendyolWebhookEvent(store, payload, created.id, { catalogRepair: 'deferred' });
  } catch (err) {
    // Transient fault — the queue + consumer tick are the replay engine now, so
    // record the failure with a backoff and return 200 instead of a 5xx that
    // would risk driving the webhook to PASSIVE. A later tick replays the row.
    syncLog.warn('webhook.process-failed-transient', {
      webhookEventId: created.id,
      storeId: store.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordTransientProcessingFailure(prisma, created.id, err);
    return c.body(null, 200);
  }
  return c.body(null, 200);
});

/**
 * P2002 re-delivery decision tree. The composite idempotency key already exists,
 * so the delivery is a duplicate of a row we already hold. There are exactly two
 * cases now — reprocessing on the retry is GONE (design §D3):
 *   - processedAt set → a true duplicate of a closed event → 200 dedup.
 *   - processedAt null → the row is still outstanding queue work, and the lease
 *     mechanism (in-request claim OR the consumer tick) is its SOLE owner. We do
 *     NOT reprocess here at any age — a second writer under Read Committed could
 *     double-insert order items. Return 200 and let the owner drive it.
 * The 2-minute "stale reprocess" branch is deliberately removed: unprocessed
 * rows are the consumer's responsibility, not the re-delivery's.
 */
async function handleReDelivery(
  c: Context<WebhookEnv>,
  store: Store,
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
    select: { id: true, processedAt: true },
  });

  if (existing === null || existing.processedAt !== null) {
    // Either the row vanished between the P2002 and this read (extremely
    // unlikely) or it is already closed — either way there is nothing to do.
    syncLog.info('webhook.deduped', {
      storeId: store.id,
      platformOrderId: key.platformOrderId,
      platformStatus: key.platformStatus,
      lastModifiedDate: key.lastModifiedDate.toISOString(),
    });
    return c.body(null, 200);
  }

  // Unprocessed → the lease owner (in-request claim or consumer tick) drives it.
  // Do NOT reprocess on this re-delivery; just acknowledge.
  syncLog.info('webhook.redelivery-unprocessed-owned-by-consumer', {
    storeId: store.id,
    platformOrderId: key.platformOrderId,
    webhookEventId: existing.id,
  });
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
