/**
 * Trendyol webhook event processing pipeline.
 *
 * Extracted from `routes/webhooks/trendyol-orders.routes.ts` so the receiver
 * route and the stale-event reprocessing path share ONE implementation. The
 * route owns HTTP concerns (auth, idempotency-row lifecycle, status codes);
 * this service owns the "given a persisted WebhookEvent row, process it" work:
 * status mapping, fee resolution, payload mapping, catalog repair, intake
 * dispatch, and the RETURNED → CLAIMS acceleration.
 *
 * Error contract (drives the receiver's HTTP behaviour):
 *   - DETERMINISTIC failures resolve to a terminal WebhookEvent state and
 *     return normally (the route replies 200 — retrying would never help):
 *       · unknown status  → mark `processedAt`, skip intake.
 *       · payload-map fail → mark `processedAt` + `processingError`.
 *   - TRANSIENT failures (fee resolution, intake, DB) PROPAGATE out. The route
 *     records `processingError` and rethrows → 500 → Trendyol replays the
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

import { mapTrendyolWebhookPayload } from '../../routes/webhooks/trendyol-orders.mapper';

export async function processTrendyolWebhookEvent(
  store: Store,
  payload: TrendyolShipmentPackage,
  webhookEventId: string,
): Promise<void> {
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
  // Commission KDV oranı DB'den (denetim A — fee_definitions ALL/COMMISSION_INVOICE).
  // `at` = siparişin tarihi (payload.orderDate, mapper'la aynı normalize): settlement
  // handler'ları da order.orderDate'e göre çözer → T+0 tahmin ile mutabakat aynı oranı
  // kullanır. Bulunamazsa loud throw (seed eksik = yanlış kurulum) — bu transient
  // sınıfa girer ve dışarı propagate olur (route rethrow → Trendyol tekrar dener).
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

  // ─── Anında katalog onarımı (spec 2026-06-12 §4 + K6) ───────────────────
  // Bilinmeyen barkod tekil vendor sorgusuyla kataloğa eklenir — sipariş satırı
  // kimliğiyle doğar, satıcı pencere içinde maliyet ekleyebilir. Başarısızlık
  // intake'i BLOKE ETMEZ (satır eşleşmeden devam eder; tick gün içinde onarır).
  await ensureBarcodesInCatalog(store, [...new Set(mapped.lines.map((line) => line.barcode))]);

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

  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processedAt: new Date() },
  });

  // ─── RETURNED → CLAIMS hızlandırma (Task 8) ────────────────────────────
  // Trendyol iade webhook'u iade detayını taşımaz; gerçek veri getClaims
  // API'sinden gelir (~6 saatte bir cron ile). Müşteri iadesinin kâra
  // yansıması için CLAIMS sync'i hemen kuyruğa alırız — söz konusu mağaza
  // için aktif bir CLAIMS satırı varsa (SyncInProgressError) sessizce devam
  // ederiz (dedup). Enqueue başarısızlığı asla event işlemeyi bloke etmez.
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
        // Beklenmedik hata — loglayıp devam et, webhook'u başarısız sayma.
        syncLog.warn('webhook.claims-enqueue-failed', {
          storeId: store.id,
          platformOrderId,
          errorMessage: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
        });
      }
      // SyncInProgressError: aktif CLAIMS sync zaten var — dedup, işlem gerekmez.
    }
  }
}
