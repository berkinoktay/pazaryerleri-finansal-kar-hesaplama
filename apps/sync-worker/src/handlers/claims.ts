// Claims (iade talepleri) module handler — PR-13.
//
// One chunk = one full 60-day claims window scan. Single-chunk semantics
// (settlements/cron.ts precedent): claim volume is a small fraction of
// order volume (prod probe 2026-06-10: 76 claims / 60 days), per-claim
// $transaction isolation gives partial-fail recovery, and the 60d range
// is accepted by Trendyol in ONE paged request (probe-proven) — no
// sub-window slicing, no cursor resume.
//
// Window rationale: getClaims startDate/endDate filter on the claim's
// CREATION date — a status update does NOT move the claim into a newer
// window. A 15-day window would permanently miss status transitions on
// claims older than 15 days (disputes can run for weeks), so the scan
// re-reads 60 days every tick and upserts status changes idempotently.
//
// resolved semantics (Berkin'in kararı 2026-06-10): claim resolves from
// its OWN item statuses — all items terminal (Accepted/Rejected/Cancelled)
// → resolved=true. NOT from settlement Return matching (that path runs
// independently and adjusts profit; this table is the early-warning /
// "iade riski" surface).
//
// Order matching (tenant safety — every query is storeId-scoped):
//   1. PRIMARY  claim.orderOutboundPackageId == Order.platformOrderId
//      (proven on stage 950608199; 0/76 null on prod)
//   2. FALLBACK claim.orderNumber == Order.platformOrderNumber, single
//      candidate only (legacy rows / defensive)
//   3. no match → warn + skip; the next 6h scan retries naturally.
//
// Item matching: items[].orderLine.id == OrderItem.platformLineId.
// claimItems[].orderLineItemId is a per-UNIT id and is NOT the line id.
// Orders synced before PR-8 carry platformLineId=null → orderItemId stays
// null (schema allows it; UI degrades gracefully).
//
// PII: the mapper (mapTrendyolClaim) already drops customerFirstName/
// LastName; externalRef stores a minimal non-PII audit ref only.

import { prisma } from '@pazarsync/db';
import type { Prisma, SyncLog } from '@pazarsync/db';
import {
  decryptStoreCredentials,
  fetchClaims,
  mapTrendyolClaim,
  UNKNOWN_REASON_CODE,
  type FetchClaimsOpts,
  type MappedClaim,
  type TrendyolClaim,
} from '@pazarsync/marketplace';
import { estimateReturnOnClaim } from '@pazarsync/profit';
import { syncLog, syncLogService } from '@pazarsync/sync-core';

import { computeOrdersCutoffMs } from './orders';

import type { ChunkResult, ModuleHandler } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Heartbeat cadence: stamp lastTickAt every N processed claims so the
 * 90s stale-claim watchdog never reaps a live full-window scan (this
 * handler is single-chunk and would otherwise never tick mid-run).
 */
const HEARTBEAT_EVERY_N_CLAIMS = 25;

/**
 * Scan window. Wider than the design doc's original 15d on purpose: the
 * date filter is creation-date-based (see module header), and 60d matches
 * the settlements scan philosophy (covers Trendyol's slowest dispute
 * lifecycles with buffer). Probe 2026-06-10: one request accepts 60d.
 */
const SCAN_WINDOW_DAYS = 60;

// ─── DI shape for fetchers (test-mockable) ──────────────────────────────

export interface ClaimsFetchers {
  fetchClaims: (opts: FetchClaimsOpts) => AsyncGenerator<TrendyolClaim, void>;
}

const DEFAULT_FETCHERS: ClaimsFetchers = { fetchClaims };

// ─── Handler ─────────────────────────────────────────────────────────────

/**
 * Process one full claims cycle for a store.
 *
 * Cursor: unused — the window is always "now − 60d → now"; idempotent
 * upserts absorb the 6h-tick overlap.
 */
export async function processClaimsChunk(
  input: { syncLog: SyncLog; cursor: unknown | null; workerId: string },
  fetchers: ClaimsFetchers = DEFAULT_FETCHERS,
): Promise<ChunkResult> {
  const { syncLog: log, workerId } = input;

  syncLog.info('claims.chunk.start', { syncLogId: log.id, storeId: log.storeId });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  const endDate = new Date();
  // Clamp the scan start to the same cutoff the orders backfill uses
  // (computeOrdersCutoffMs) rather than a bare store.createdAt. The getClaims
  // filter is on the claim's CREATION date, and no claim for a post-connect
  // order can be dated before the store existed. In production
  // (SYNC_HISTORICAL_BACKFILL_DAYS=0) that cutoff IS store.createdAt, so the
  // behavior is unchanged: the pre-cutoff slice can only be empty and
  // requesting it just wastes a vendor call. In dev/stage with a positive
  // backfill the claims scan honors the same historical window as the orders
  // it reconciles (env.ts documents this escape hatch). The write layer's
  // order_not_found skips remain the correctness net.
  const startDate = new Date(
    Math.max(
      endDate.getTime() - SCAN_WINDOW_DAYS * MS_PER_DAY,
      computeOrdersCutoffMs({ storeCreatedAt: store.createdAt, endDate: endDate.getTime() }),
    ),
  );

  let written = 0;
  let unmatched = 0;
  let failed = 0;
  let processed = 0;
  let lastError: unknown = null;

  const generator = fetchers.fetchClaims({
    environment: store.environment,
    credentials,
    startDate,
    endDate,
  });

  for await (const raw of generator) {
    processed += 1;
    if (processed % HEARTBEAT_EVERY_N_CLAIMS === 0) {
      await syncLogService.heartbeat(log.id, workerId);
    }
    try {
      const mapped = mapTrendyolClaim(raw);
      const outcome = await prisma.$transaction(async (tx) => {
        return upsertClaim(store.id, mapped, tx);
      });
      if (outcome === 'written') {
        written += 1;
      } else {
        unmatched += 1;
      }
    } catch (err) {
      failed += 1;
      lastError = err;
      syncLog.error('claims.upsert.failed', {
        syncLogId: log.id,
        storeId: store.id,
        trendyolClaimId: raw.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Per-claim isolation is for SPORADIC bad rows (orders/settlements
  // precedent). When EVERY claim in the window failed to persist
  // (unmatched counts as a successful pass — it just had no order),
  // the failure is systemic (DB down, schema drift) — swallowing it
  // would mark the run COMPLETED and mute the retry machinery. Rethrow
  // the last error so handleRunError classifies + backs off.
  if (failed > 0 && written === 0 && unmatched === 0) {
    throw lastError;
  }

  syncLog.info('claims.chunk.done', {
    syncLogId: log.id,
    storeId: store.id,
    written,
    unmatched,
    failed,
  });

  return { kind: 'done', finalCount: written };
}

type UpsertOutcome = 'written' | 'unmatched';

async function upsertClaim(
  storeId: string,
  claim: MappedClaim,
  tx: Prisma.TransactionClient,
): Promise<UpsertOutcome> {
  // 1. Order match — ALWAYS storeId-scoped; a claim can never attach to
  //    another store's (or org's) order, even on orderNumber collision.
  let order: { id: string; organizationId: string } | null = null;

  if (claim.orderOutboundPackageId !== null) {
    order = await tx.order.findFirst({
      where: { storeId, platformOrderId: claim.orderOutboundPackageId },
      select: { id: true, organizationId: true },
    });
  } else {
    // orderNumber fallback runs ONLY when the wire carried no outbound
    // package id (legacy/defensive — 0/76 on prod). When the id is
    // present but its order is not synced yet, attaching to a same-
    // numbered sibling package would be a wrong-package write that the
    // next scan can't cleanly undo; "unmatched" + natural 6h retry is
    // strictly safer (the order sync will materialize the real package).
    const candidates = await tx.order.findMany({
      where: { storeId, platformOrderNumber: claim.orderNumber },
      select: { id: true, organizationId: true },
      take: 2,
    });
    if (candidates.length === 1) {
      order = candidates[0] ?? null;
    }
  }

  if (order === null) {
    syncLog.warn('claims.order.unmatched', {
      storeId,
      trendyolClaimId: claim.trendyolClaimId,
      orderNumber: claim.orderNumber,
      orderOutboundPackageId: claim.orderOutboundPackageId,
    });
    return 'unmatched';
  }

  // Re-anchor: if this Trendyol claim was previously attached to a
  // DIFFERENT order row of the same store (e.g. an early fallback match
  // before the real package synced, or Trendyol enriching a formerly
  // id-less claim), move the existing row instead of creating a
  // duplicate — the unique key is (orderId, trendyolClaimId), so a
  // plain upsert under the new order would silently double-count the
  // return. Stale item links are nulled; the item pass below re-resolves
  // them against the new order's lines. storeId is the denormalized
  // column (#298) — no parent-walk.
  const existing = await tx.orderClaim.findFirst({
    where: {
      trendyolClaimId: claim.trendyolClaimId,
      orderId: { not: order.id },
      storeId,
    },
    select: { id: true, orderId: true },
  });
  if (existing !== null) {
    syncLog.warn('claims.order.reanchored', {
      storeId,
      trendyolClaimId: claim.trendyolClaimId,
      fromOrderId: existing.orderId,
      toOrderId: order.id,
    });
    await tx.orderClaim.update({
      where: { id: existing.id },
      data: { orderId: order.id, organizationId: order.organizationId, storeId },
    });
    await tx.orderClaimItem.updateMany({
      where: { claimId: existing.id },
      data: { orderItemId: null },
    });
  }

  // Minimal NON-PII audit ref. Never the raw payload (it carries customer
  // names); audit-only since #298 — the bridge reads the COLUMNS below.
  const externalRef = {
    orderOutboundPackageId: claim.orderOutboundPackageId,
    orderShipmentPackageId: claim.orderShipmentPackageId,
    lastModifiedDate: claim.lastModifiedDate?.toISOString() ?? null,
  };

  // 2. Claim upsert — organizationId + storeId denormalized from the PARENT
  //    ORDER side (never from the payload). claimDate is immutable after
  //    create. Package-id columns (#298): orderShipmentPackageId is the
  //    RETURN parcel id the settlement Return bridge looks up — load-bearing,
  //    so unlike the audit blob it NULL-PRESERVES on update (a sparse tick
  //    must never blank the bridge key).
  const dbClaim = await tx.orderClaim.upsert({
    where: {
      orderId_trendyolClaimId: { orderId: order.id, trendyolClaimId: claim.trendyolClaimId },
    },
    create: {
      organizationId: order.organizationId,
      storeId,
      orderId: order.id,
      trendyolClaimId: claim.trendyolClaimId,
      claimDate: claim.claimDate,
      cargoProviderName: claim.cargoProviderName,
      cargoTrackingNumber:
        claim.cargoTrackingNumber !== null ? BigInt(claim.cargoTrackingNumber) : null,
      resolved: claim.resolved,
      orderShipmentPackageId: claim.orderShipmentPackageId,
      orderOutboundPackageId: claim.orderOutboundPackageId,
      externalRef,
    },
    update: {
      // Null-preserve on cargo + package-id fields (they can lag behind
      // claim creation). resolved follows the latest scan ONLY when the
      // scan carried item data — an itemless/sparse payload must never
      // regress true→false. externalRef always refreshes (audit-only).
      ...(claim.cargoProviderName !== null ? { cargoProviderName: claim.cargoProviderName } : {}),
      ...(claim.cargoTrackingNumber !== null
        ? { cargoTrackingNumber: BigInt(claim.cargoTrackingNumber) }
        : {}),
      ...(claim.items.length > 0 ? { resolved: claim.resolved } : {}),
      ...(claim.orderShipmentPackageId !== null
        ? { orderShipmentPackageId: claim.orderShipmentPackageId }
        : {}),
      ...(claim.orderOutboundPackageId !== null
        ? { orderOutboundPackageId: claim.orderOutboundPackageId }
        : {}),
      externalRef,
    },
    select: { id: true },
  });

  // 3. Items — one row per Trendyol claimLineItem (per UNIT). Status is
  //    live state, updated every scan (CRUD's U — claims are not snapshots).
  for (const item of claim.items) {
    let orderItemId: string | null = null;
    if (item.orderLineId !== null) {
      const orderItem = await tx.orderItem.findFirst({
        where: { orderId: order.id, platformLineId: BigInt(item.orderLineId) },
        select: { id: true },
      });
      orderItemId = orderItem?.id ?? null;
    }

    await tx.orderClaimItem.upsert({
      where: {
        claimId_trendyolClaimItemId: {
          claimId: dbClaim.id,
          trendyolClaimItemId: item.trendyolClaimItemId,
        },
      },
      create: {
        claimId: dbClaim.id,
        orderItemId,
        trendyolClaimItemId: item.trendyolClaimItemId,
        reasonCode: item.reasonCode,
        reasonName: item.reasonName,
        status: item.status,
        acceptedBySeller: item.acceptedBySeller,
        autoApproveDate: item.autoApproveDate,
        resolved: item.resolved,
      },
      update: {
        status: item.status,
        acceptedBySeller: item.acceptedBySeller,
        autoApproveDate: item.autoApproveDate,
        resolved: item.resolved,
        // Reason refreshes only when the scan carried a real code — a
        // sparse tick must not downgrade a known reason to UNKNOWN.
        ...(item.reasonCode !== UNKNOWN_REASON_CODE
          ? { reasonCode: item.reasonCode, reasonName: item.reasonName }
          : {}),
        // Null-preserve: keep an existing link if this scan failed to
        // resolve one (an order item is never un-linked by a later scan).
        ...(orderItemId !== null ? { orderItemId } : {}),
      },
    });
  }

  // İade gerçekleşme tetikleyici (backstop): bu claim'de kabul edilmiş (Accepted) birim
  // varsa erken iade tahminini hesapla (estimateReturnOnClaim idempotent: tek-satır upsert + fold).
  // Webhook bu yolu hızlandırır (ayrı task); cron bu handler'ı düzenli çağırır.
  if (claim.items.some((it) => it.status === 'Accepted')) {
    await estimateReturnOnClaim(order.id, tx);
  }

  return 'written';
}

export const claimsHandler: ModuleHandler = { processChunk: processClaimsChunk };
