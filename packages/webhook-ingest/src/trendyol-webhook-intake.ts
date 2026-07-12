/**
 * Trendyol webhook event processing pipeline.
 *
 * Extracted from `apps/api` so the receiver route and the (future) worker
 * consumer tick share ONE implementation. The route owns HTTP concerns (auth,
 * idempotency-row lifecycle, status codes); this pipeline owns the "given a
 * persisted WebhookEvent row, process it" work: status mapping, fee resolution,
 * payload mapping, catalog repair, intake dispatch, and the RETURNED -> CLAIMS
 * acceleration.
 *
 * Error contract (drives the receiver's HTTP behaviour):
 *   - DETERMINISTIC failures resolve to a terminal WebhookEvent state and
 *     return normally (the route replies 200 — retrying would never help):
 *       · unknown status  -> mark `processedAt`, skip intake.
 *       · payload-map fail -> mark `processedAt` + `processingError`.
 *   - TRANSIENT failures (fee resolution, intake, DB) PROPAGATE out. The route
 *     records `processingError` and rethrows -> 500 -> Trendyol replays the
 *     delivery in ~5 minutes, turning its retry into our replay engine.
 */

import { ensureBarcodesInCatalog } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import { Prisma, type Store } from '@pazarsync/db';
import {
  mapTrendyolStatusToEnum,
  type MappedOrder,
  type TrendyolShipmentPackage,
} from '@pazarsync/marketplace';
import { intakeOrder } from '@pazarsync/order-sync';
import { resolveFeeDefinition } from '@pazarsync/profit';
import { syncLog, syncLogService, SyncInProgressError } from '@pazarsync/sync-core';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import { mapTrendyolWebhookPayload } from './trendyol-orders.mapper';

/**
 * Controls whether the catalog is repaired inside the request path.
 *   - 'eager'    -> run `ensureBarcodesInCatalog` before intake (up to 5 live
 *                   vendor lookups). Today's behaviour for every caller.
 *   - 'deferred' -> skip the catalog call so the request never blocks on a
 *                   vendor lookup; the 60s variant-resolution tick is the
 *                   backstop (order-line variant recovery epic: the order is
 *                   always written, the barcode is recovered afterwards).
 */
export interface ProcessTrendyolWebhookEventOptions {
  catalogRepair?: 'eager' | 'deferred';
}

export async function processTrendyolWebhookEvent(
  store: Store,
  payload: TrendyolShipmentPackage,
  webhookEventId: string,
  options?: ProcessTrendyolWebhookEventOptions,
): Promise<void> {
  const catalogRepair = options?.catalogRepair ?? 'eager';
  const platformOrderId = String(payload.shipmentPackageId);
  const platformStatus = payload.status;

  // ─── Status mapping (forward-compat fallback) ──────────────────────────
  const mappedStatus = mapTrendyolStatusToEnum(platformStatus);
  if (mappedStatus === null) {
    syncLog.warn('webhook.unknown-status', {
      storeId: store.id,
      platformOrderId,
      rawStatus: platformStatus,
    });
    // Order.status untouched — event logged, dispatch skipped, terminal 200.
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date() },
    });
    return;
  }

  // ─── Build MappedOrder + dispatch ──────────────────────────────────────
  // Commission VAT rate comes from the DB (audit A — fee_definitions
  // ALL/COMMISSION_INVOICE). `at` = the order's date (payload.orderDate,
  // normalized the same way as the mapper): the settlement handlers also
  // resolve by order.orderDate, so the T+0 estimate and the reconciliation use
  // the same rate. Missing -> loud throw (missing seed = misconfiguration) —
  // this is TRANSIENT and propagates out (route rethrow -> Trendyol retries).
  const commissionVatDef = await resolveFeeDefinition(prisma, {
    platform: store.platform,
    feeType: 'COMMISSION_INVOICE',
    at: businessZoneEpochToInstant(payload.orderDate),
  });

  let mapped: MappedOrder;
  try {
    mapped = mapTrendyolWebhookPayload(
      payload,
      mappedStatus,
      Number(commissionVatDef.defaultVatRate),
    );
  } catch (err) {
    // Deterministic payload defect: retrying the same body never helps, so we
    // mark the event terminal (handled-but-unprocessable) and return — the
    // route replies 200 rather than looping Trendyol on a 5xx forever.
    const message = err instanceof Error ? err.message : String(err);
    syncLog.error('webhook.payload-map-failed', {
      storeId: store.id,
      platformOrderId,
      errorMessage: message,
    });
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date(), processingError: message },
    });
    return;
  }

  // ─── Eager catalog repair (spec 2026-06-12 §4 + K6) ─────────────────────
  // An unknown barcode is added to the catalog via a single vendor lookup — the
  // order line is born with its identity, so the seller can add a cost within
  // the window. Failure does NOT block intake (the line proceeds unmatched; the
  // tick repairs it during the day). Skipped when catalogRepair === 'deferred'
  // (D5): the 60s variant-resolution tick is the backstop.
  if (catalogRepair === 'eager') {
    await ensureBarcodesInCatalog(store, [...new Set(mapped.lines.map((line) => line.barcode))]);
  }

  // ─── Intake routing (Slice 0 shared helper) ────────────────────────────
  // calculable → orders; cost-missing today → buffer; cost-missing past-day →
  // orders PROFIT-EXCLUDED (spec 2026-06-12). Unmatched variant lines fold into
  // cost_missing — the order is ALWAYS written. Identical to the sync-worker.
  const outcome = await intakeOrder({
    storeId: store.id,
    organizationId: store.organizationId,
    mapped,
    rawPayload: payload as unknown as Prisma.InputJsonValue,
  });

  switch (outcome.kind) {
    case 'buffered':
      syncLog.info('buffer.entry-created', {
        source: 'webhook',
        storeId: store.id,
        platformOrderId,
        orderDate: mapped.orderDate.toISOString(),
      });
      break;
    case 'buffered_deduped':
      syncLog.info('buffer.entry-deduped', {
        source: 'webhook',
        storeId: store.id,
        platformOrderId,
      });
      break;
    case 'persisted':
      syncLog.info('orders.persisted', {
        source: 'webhook',
        reason: outcome.reason,
        storeId: store.id,
        platformOrderId,
      });
      break;
    case 'dematerialized':
      // Split ghost (UnPacked) — the pre-split package was removed from the
      // books; the split children arrive as their own webhooks/sync rows.
      syncLog.info('orders.dematerialized', {
        source: 'webhook',
        storeId: store.id,
        platformOrderId,
        deletedOrder: outcome.deletedOrder,
        deletedBufferEntries: outcome.deletedBufferEntries,
      });
      break;
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled intake outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }

  // Clear any stale `processingError` from an earlier TRANSIENT attempt: a prior
  // pass may have written a fault note (e.g. fee resolution failed) before this
  // replay succeeded, and leaving that note on a now-processed row is misleading in
  // the audit trail (live observation, issue #458). The deterministic dead-end
  // stamps (unknown status, payload-map failure) are unaffected — they return
  // before reaching this success stamp.
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processedAt: new Date(), processingError: null },
  });

  // ─── RETURNED -> CLAIMS acceleration (Task 8) ──────────────────────────
  // The Trendyol return webhook does not carry the return detail; the real data
  // comes from the getClaims API (~every 6 hours via cron). To reflect the
  // customer return in profit sooner we enqueue a CLAIMS sync right away — if an
  // active CLAIMS row already exists for this store (SyncInProgressError) we
  // silently continue (dedup). An enqueue failure never blocks event processing.
  if (mappedStatus === 'RETURNED') {
    try {
      await syncLogService.acquireSlot(store.organizationId, store.id, 'CLAIMS');
      syncLog.info('webhook.claims-enqueued', {
        storeId: store.id,
        platformOrderId,
        reason: 'RETURNED_webhook_accelerates_getClaims',
      });
    } catch (enqueueErr) {
      if (!(enqueueErr instanceof SyncInProgressError)) {
        // Unexpected error — log and continue, do not fail the webhook.
        syncLog.warn('webhook.claims-enqueue-failed', {
          storeId: store.id,
          platformOrderId,
          errorMessage: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
        });
      }
      // SyncInProgressError: an active CLAIMS sync already exists — dedup, no work needed.
    }
  }
}
