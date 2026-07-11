/**
 * Webhook-events consumer tick (design 2026-07-11 Paket D §D4).
 *
 * Drains the durable `webhook_events` ingest queue: the receiver route persists
 * one row per Trendyol delivery, and this tick claims outstanding rows and drives
 * each through the SHARED processor (`processTrendyolWebhookEvent` in
 * `@pazarsync/webhook-ingest`) — the same pipeline the in-request path uses.
 *
 * Concurrency model — two layers, each with a scope and a caveat:
 *   1. Cross-writer (this tick vs. the receiver route, or two worker instances):
 *      every processor must WIN a conditional-UPDATE lease before touching a row.
 *      That closes the SIMULTANEOUS-claim race — two callers racing the same
 *      `processed_at IS NULL AND next_process_at <= now()` predicate can never
 *      both come back with rowCount 1 — BUT only while a claim's work finishes
 *      inside the lease window. If processing outran WEBHOOK_EVENT_LEASE_MS the
 *      row would become re-claimable WHILE still in flight, and a slow processor
 *      plus an overlap could double-insert order items. We keep the work well
 *      under the lease by running catalog repair 'deferred' (see below), so the
 *      tick is DB-only and finishes in milliseconds — that is the fix for the
 *      time-race, not the lease alone.
 *   2. Same-process overlap (boot run + 5 s interval, or a tick that runs past
 *      the interval): the module-level `tickInFlight` guard makes a re-entrant
 *      call a no-op (returns 0). This is what structurally closes the single-
 *      process re-claim hole, independent of any timing assumption.
 *
 * NOT covered today: a genuine MULTI-INSTANCE deployment where two processes'
 * ticks overlap AND a claim outruns its lease. `tickInFlight` is per-process and
 * the lease is not renewed mid-work, so if the worker is ever scaled past one
 * instance, move to a renewed lease or a `SELECT ... FOR UPDATE SKIP LOCKED`
 * claim (the buffer-promote emsali). The worker is single-instance today, the
 * same honest stance as the variant-resolution tick.
 *
 * Why 'deferred' catalog repair (the root-cause fix): the eager path issues up to
 * 5 live vendor lookups (a fetch-once retry chain, minutes in the worst case),
 * which can exceed the lease window. The SOLE owner of vendor traffic is the
 * variant-resolution tick (quota'd + backoff'd); this consumer runs DB-only so
 * its processing time stays safely below the lease. An uncatalogued barcode's
 * line persists unmatched and that tick repairs it (order-line variant recovery).
 *
 * Why NO `SELECT ... FOR UPDATE` row lock is held across the work: the shared
 * processor opens its OWN `$transaction` (intakeOrder) on a separate connection,
 * so a lock held here would not cover the intake writes anyway. The lease is a
 * time-boxed claim instead (WEBHOOK_EVENT_LEASE_MS); a row whose holder dies
 * mid-work becomes re-claimable once the lease elapses, and replaying it is safe.
 *
 * Shutdown-drain safe: background ticks keep firing while the worker drains, but
 * every row's work is atomic per row and idempotent — a tick interrupted between
 * rows leaves the un-started rows for the next process; a row whose lease was won
 * but whose intake did not finish replays once the lease deadline passes.
 *
 * Sequential, not Promise.all: rows are processed one at a time to stay within
 * the worker's connection budget (same discipline as the buffer-promote tick).
 */

import type { PrismaClient } from '@pazarsync/db';
import type { TrendyolShipmentPackage } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';
import {
  claimWebhookEventLease,
  processTrendyolWebhookEvent,
  recordTransientProcessingFailure,
  TrendyolWebhookPayloadSchema,
} from '@pazarsync/webhook-ingest';

/** Max unprocessed rows scanned per tick — bounds the per-tick cost. */
const SCAN_LIMIT = 25;

/** Cap the number of Zod issue codes folded into a schema-drift summary. */
const MAX_SUMMARY_ISSUES = 3;

type PayloadParse =
  | { readonly ok: true; readonly payload: TrendyolShipmentPackage }
  | { readonly ok: false; readonly summary: string };

/**
 * Narrow a persisted `raw_payload` to the domain `TrendyolShipmentPackage` the
 * shared processor consumes. The receiver route stored the FULL Trendyol body,
 * but the payload schema's inferred output type omits the interface's
 * non-validated fields (packageGrossAmount, fastDelivery, micro), so the parsed
 * value is not directly assignable — this guard bridges the JSON->domain seam
 * without a type assertion (mirrors the `isTrendyolCredentials` convention).
 *
 * It checks the SAME load-bearing fields the schema validates, so it is never
 * stricter than the route: a payload the route accepted is never rejected here.
 * The passthrough fields the mapper tolerates (`?? 0`) are left unchecked.
 */
function isTrendyolShipmentPackage(value: unknown): value is TrendyolShipmentPackage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'shipmentPackageId' in value &&
    typeof value.shipmentPackageId === 'number' &&
    'orderNumber' in value &&
    typeof value.orderNumber === 'string' &&
    'status' in value &&
    typeof value.status === 'string' &&
    'orderDate' in value &&
    typeof value.orderDate === 'number' &&
    'lastModifiedDate' in value &&
    typeof value.lastModifiedDate === 'number' &&
    'lines' in value &&
    Array.isArray(value.lines)
  );
}

/**
 * Validate + narrow a persisted `raw_payload`. Two stages, distinct jobs:
 *   1. `safeParse` is the validation gate AND the source of the human-readable
 *      drift summary (Zod issue codes) — a failure here is a deterministic
 *      dead-end (the same body will never parse).
 *   2. the guard narrows the original object to the domain type WITHOUT a type
 *      assertion. Post-schema it always passes (it checks a subset of the
 *      schema's fields); a miss is defensive and folded into drift as well.
 */
function parseEventPayload(rawPayload: unknown): PayloadParse {
  const parsed = TrendyolWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, MAX_SUMMARY_ISSUES)
      .map((issue) => issue.message)
      .join('; ');
    return { ok: false, summary };
  }
  if (!isTrendyolShipmentPackage(rawPayload)) {
    return { ok: false, summary: 'domain shape guard rejected a schema-valid payload' };
  }
  return { ok: true, payload: rawPayload };
}

/**
 * Log throttle for repeated processing failures. The tick runs every 5 s and a
 * genuinely broken store/seed can fail on every pass, so a per-row error line
 * would flood the log. Instead we drop the per-row line and emit ONE aggregate
 * summary at most every 15 min (the buffer-promote PERMANENT_FAILED pattern).
 */
const TRANSIENT_SUMMARY_THROTTLE_MS = 15 * 60_000;
let lastTransientSummaryAt = 0;

// Same-process overlap guard (variant-resolution emsali): the boot run + 5 s
// interval (or a tick that runs past its interval) can re-enter; the second
// invocation short-circuits to a no-op. This closes the single-process hole where
// a lease that elapsed mid-work could be re-claimed and processed CONCURRENTLY by
// an overlapping tick in the SAME process — independent of any timing assumption.
let tickInFlight = false;

/** Test seam: inject a fake processor to exercise the overlap guard deterministically. */
export interface WebhookConsumerDeps {
  processEvent?: typeof processTrendyolWebhookEvent;
}

/**
 * Process one tick of the webhook-events queue. Returns the number of events
 * driven to a CLOSED state this tick (a fresh success, a store-not-found stamp,
 * or a schema-drift stamp) — i.e. rows whose `processed_at` this tick set without
 * throwing. Transient failures (which stay unprocessed for a later replay, or are
 * stamped terminal by `recordTransientProcessingFailure` after the attempt cap)
 * are folded into the throttled failure summary instead, not this count.
 *
 * The `prisma` argument MUST be the shared `@pazarsync/db` singleton: the lease
 * helpers use it directly, and the shared processor uses that same singleton
 * internally, so both see one connection pool and one transactional view.
 *
 * Re-entrant calls short-circuit via `tickInFlight` (returns 0 without claiming),
 * so an overlapping same-process invocation never runs a second batch at once.
 */
export async function processWebhookEventsBatch(
  prisma: PrismaClient,
  deps: WebhookConsumerDeps = {},
): Promise<number> {
  if (tickInFlight) return 0;
  tickInFlight = true;
  try {
    return await runBatch(prisma, deps);
  } finally {
    tickInFlight = false;
  }
}

async function runBatch(prisma: PrismaClient, deps: WebhookConsumerDeps): Promise<number> {
  const processEvent = deps.processEvent ?? processTrendyolWebhookEvent;
  // Prefilter (lock-free) on the application clock — a pure PRE-screen. The
  // authoritative decision is the claim's conditional UPDATE, which re-evaluates
  // eligibility against the DB `now()`; a row that slips through here but is no
  // longer due (or was grabbed by another writer) simply loses the claim below.
  const candidates = await prisma.webhookEvent.findMany({
    where: {
      processedAt: null,
      OR: [{ nextProcessAt: null }, { nextProcessAt: { lte: new Date() } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: SCAN_LIMIT,
    select: { id: true, storeId: true, rawPayload: true },
  });

  let closed = 0;
  const transientFailedIds: string[] = [];

  // Sequential (no Promise.all): one row at a time keeps the connection budget
  // bounded — the shared processor opens its own intake transaction per row.
  for (const event of candidates) {
    const leased = await claimWebhookEventLease(prisma, event.id);
    if (!leased) {
      // Another writer (a peer tick or the receiver route) owns the lease, or the
      // row closed between the prefilter and the claim. Skip — not our work.
      continue;
    }

    const store = await prisma.store.findUnique({ where: { id: event.storeId } });
    if (store === null) {
      // Disconnect race: the store was deleted after the row was enqueued. The FK
      // cascade normally removes the event too, so this is a defensive stamp for
      // the sliver where the cascade has not yet committed. Close it — retrying a
      // storeless event can never succeed.
      await stampClosed(prisma, event.id, 'store not found (consumer)');
      closed += 1;
      continue;
    }

    // Re-validate the persisted payload against the shared schema. A failure is a
    // DETERMINISTIC dead-end (schema drift): the same body will never parse, so we
    // stamp the row closed instead of replaying it forever.
    const parse = parseEventPayload(event.rawPayload);
    if (!parse.ok) {
      await stampClosed(prisma, event.id, `payload schema drift: ${parse.summary}`);
      closed += 1;
      continue;
    }

    try {
      // 'deferred' catalog repair: the tick must stay DB-only so its processing
      // time stays safely under the lease window (an eager path's up-to-5 vendor
      // lookups could outrun the lease and re-open the concurrency hole — that is
      // the root cause this fixes). The variant-resolution tick is the sole owner
      // of vendor traffic and backstops any uncatalogued barcode. The processor
      // stamps `processed_at` itself on a success or a deterministic dead-end
      // (unknown status / payload-map failure).
      await processEvent(store, parse.payload, event.id, { catalogRepair: 'deferred' });
      closed += 1;
    } catch (err) {
      // TRANSIENT fault (fee resolution, intake, DB): record the failure with a
      // backoff so a later tick replays the row (or stamp it terminal once the
      // attempt cap is hit). The per-row error is NOT logged — the tick folds all
      // of this pass's failures into one throttled summary below.
      await recordTransientProcessingFailure(prisma, event.id, err);
      transientFailedIds.push(event.id);
    }
  }

  // One tidy info line per non-empty tick (stay silent on an idle pass, whose 5 s
  // cadence would otherwise log forever). Kept deliberately simple — no per-store
  // breakdown.
  if (closed > 0) {
    syncLog.info('webhook.consumer-batch', { processed: closed });
  }

  // Throttled aggregate for renewed transient failures: at most one summary every
  // 15 min, only when this tick saw at least one failure.
  if (transientFailedIds.length > 0) {
    const nowMs = Date.now();
    if (nowMs - lastTransientSummaryAt >= TRANSIENT_SUMMARY_THROTTLE_MS) {
      syncLog.error('webhook.consumer-transient-summary', {
        failedCount: transientFailedIds.length,
        sampleEventIds: transientFailedIds.slice(0, 5),
      });
      lastTransientSummaryAt = nowMs;
    }
  }

  return closed;
}

/**
 * Stamp a webhook event CLOSED with a deterministic reason (store-not-found or
 * schema drift). `processed_at = now()` drops the row from the unprocessed
 * partial index; `processing_error` records why for the audit trail.
 */
async function stampClosed(
  prisma: PrismaClient,
  webhookEventId: string,
  reason: string,
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processedAt: new Date(), processingError: reason },
  });
}
