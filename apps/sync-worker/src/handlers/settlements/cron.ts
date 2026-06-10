// Settlement cron module handler (PR-7 commit 8).
//
// One chunk = one full settlement window scan (3 settlements transactionTypes
// + 3 otherfinancials types). Single-chunk semantics chosen because:
//   - 60-day window total volume << orders epic's 90-day backfill
//   - Per-row $transaction isolation already gives partial-fail recovery
//   - Cursor-resume per-page complexity defers V2 scaling work
//
// Cron cadence (design §5.5 line 1139-1140):
//   - Settlement scan: 6 saat / 60 gün window
//   - Settlement re-poll (PR-12): same scan, surfaces orphan paymentOrderId
//
// Window sizing (PR-7 stage validation BUG #5, 2026-05-22): Trendyol pays
// orders via weekly Wednesday cycles after a category-dependent payment
// term (paymentPeriod 7-28 days; see cari-hesap-ekstresi doc line 103).
// Worst case lifecycle: T+10 delivery + T+28 payment term + T+7 Wednesday
// wait = T+45. 15-day window (V1 initial estimate) missed the entire
// stamping phase — observed empirically in stage as 0/500 paymentOrderId
// in T-15..T-0 vs 97/500 in T-30..T-15. 60d = 15d safety buffer over T+45.
//
// API constraint (BUG #6, 2026-05-22): /financial/settlements and
// /financial/otherfinancials enforce a 15-day max window on each call
// (FINANCIAL_WINDOW_MAX_DAYS from settlements client; cari-hesap-ekstresi
// doc: "Başlangıç ve bitiş tarihi arasındaki süre 15 günden uzun
// olamaz."). The 60d scan is therefore sliced into ceil(60/15)=4
// sliding chunks, each ≤15d. Chunk boundaries align so the newest
// chunk ends at `now`; the oldest chunk's start is clamped to
// `now − SCAN_WINDOW_DAYS` if the slice would otherwise overshoot.
//
// 6h tick / 60d window overlap is ~59.75d. Handlers' idempotency anchors
// (handleSale OrderItem update no-op; handleReturn externalRef.trendyolId
// pre-insert check; handleCommissionInvoice null FK filter; PaymentOrder
// confirmedAt null filter; fastDelivery derivedFrom marker) absorb the
// re-poll without duplicates.
//
// Per-row resilience: each transaction wraps a single dispatch. A malformed
// row logs + skips; the rest of the cycle continues. orders.ts pattern
// mirror.
//
// Dependency injection: `fetchers` parameter accepts mock fetchers in
// tests; production calls use the @pazarsync/marketplace defaults.

import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';
import {
  decryptStoreCredentials,
  fetchAllCargoInvoiceItems,
  fetchOtherFinancials,
  fetchSettlements,
  FINANCIAL_WINDOW_MAX_DAYS,
  getCargoInvoiceSerial,
  type CargoInvoiceItem,
  type FetchCargoInvoiceItemsOpts,
  type FetchOtherFinancialsOpts,
  type FetchSettlementsOpts,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { syncLog, syncLogService } from '@pazarsync/sync-core';
import { bumpReconciliationStatusForStore } from './status-bump';
import { dispatchOtherFinancialRow, dispatchSettlementRow } from './dispatcher';
import { handleCargoInvoiceItems } from './cargo-invoice-fees';
import type { ChunkResult, ModuleHandler } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCAN_WINDOW_DAYS = 60;

// V1 happy path — research §3.3 confirmed only Sale/Discount/Return have
// nonzero observations in 60-day windows. Rare types stay enumerated in
// dispatcher.ts (audit log fall-through) but the cron loop skips them
// for now to reduce API calls. They'll surface naturally once stage
// produces concrete rows (PR-N follow-up).
const SETTLEMENT_TYPES = ['Sale', 'Discount', 'Return'] as const;
const OTHER_FINANCIAL_TYPES = ['PaymentOrder', 'Stoppage', 'DeductionInvoices'] as const;

// ─── DI shape for fetchers (test-mockable) ──────────────────────────────

export interface SettlementsFetchers {
  fetchSettlements: (
    opts: FetchSettlementsOpts,
  ) => AsyncGenerator<TrendyolFinancialTransaction, void>;
  fetchOtherFinancials: (
    opts: FetchOtherFinancialsOpts,
  ) => AsyncGenerator<TrendyolFinancialTransaction, void>;
  /** PR-8: kargo faturasi item'lari — cron tx DISINDA ceker (ag cagrisi). */
  fetchCargoInvoiceItems: (opts: FetchCargoInvoiceItemsOpts) => Promise<CargoInvoiceItem[]>;
}

const DEFAULT_FETCHERS: SettlementsFetchers = {
  fetchSettlements,
  fetchOtherFinancials,
  fetchCargoInvoiceItems: fetchAllCargoInvoiceItems,
};

// ─── Handler ─────────────────────────────────────────────────────────────

/**
 * Process one full settlement cycle for a store.
 *
 * Cursor: unused. Settlement window is always "now − 60d → now" — re-poll
 * cron handles drift, no resume state needed.
 *
 * Returns `done` with the total row count consumed (telemetry only — the
 * dispatcher doesn't iterate further).
 */
export async function processSettlementsChunk(
  input: { syncLog: SyncLog; cursor: unknown | null },
  fetchers: SettlementsFetchers = DEFAULT_FETCHERS,
): Promise<ChunkResult> {
  const { syncLog: log } = input;

  syncLog.info('settlements.chunk.start', { syncLogId: log.id, storeId: log.storeId });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  const endDate = new Date();
  const overallStartTime = endDate.getTime() - SCAN_WINDOW_DAYS * MS_PER_DAY;
  const chunkCount = Math.ceil(SCAN_WINDOW_DAYS / FINANCIAL_WINDOW_MAX_DAYS);

  let totalProcessed = 0;

  // Slide newest → oldest in FINANCIAL_WINDOW_MAX_DAYS slices. Oldest chunk
  // start is clamped to overallStartTime so non-divisible SCAN_WINDOW_DAYS
  // values (e.g. 50d / 15d → 4 chunks but the 4th is 5d) still respect the
  // configured scan window.
  for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx += 1) {
    // Heartbeat: this handler is single-chunk (never ticks via loop.ts),
    // and a full 60d scan can outlive the 90s stale-claim watchdog —
    // stamp lastTickAt once per window slice so a live scan is never
    // reaped and re-run concurrently by a peer worker.
    await syncLogService.heartbeat(log.id);

    const chunkEndMs = endDate.getTime() - chunkIdx * FINANCIAL_WINDOW_MAX_DAYS * MS_PER_DAY;
    const chunkStartMs = Math.max(
      chunkEndMs - FINANCIAL_WINDOW_MAX_DAYS * MS_PER_DAY,
      overallStartTime,
    );
    const chunkEnd = new Date(chunkEndMs);
    const chunkStart = new Date(chunkStartMs);

    for (const transactionType of SETTLEMENT_TYPES) {
      await syncLogService.heartbeat(log.id);
      const generator = fetchers.fetchSettlements({
        environment: store.environment,
        credentials,
        transactionType,
        startDate: chunkStart,
        endDate: chunkEnd,
      });
      for await (const row of generator) {
        try {
          await prisma.$transaction(async (tx) => {
            await dispatchSettlementRow(store.id, store.organizationId, transactionType, row, tx);
          });
          totalProcessed += 1;
        } catch (err) {
          syncLog.error('settlements.dispatch.failed', {
            syncLogId: log.id,
            storeId: store.id,
            rowId: row.id,
            transactionType,
            chunkIdx,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    for (const transactionType of OTHER_FINANCIAL_TYPES) {
      await syncLogService.heartbeat(log.id);
      const generator = fetchers.fetchOtherFinancials({
        environment: store.environment,
        credentials,
        transactionType,
        startDate: chunkStart,
        endDate: chunkEnd,
      });
      for await (const row of generator) {
        try {
          // PR-8: kargo faturasi satiri — once item'lari AG uzerinden cek
          // (tx disinda), sonra eslestirme + OrderFee yazimini tx icinde isle.
          // Dispatcher'a gondermiyoruz; oradaki cargo_invoice dali yalniz
          // guvenlik logu olarak kalir.
          const cargoSerial = getCargoInvoiceSerial(transactionType, row);
          if (cargoSerial !== null) {
            const items = await fetchers.fetchCargoInvoiceItems({
              environment: store.environment,
              credentials,
              invoiceSerialNumber: cargoSerial,
            });
            await prisma.$transaction(async (tx) => {
              await handleCargoInvoiceItems(store.id, store.organizationId, row, items, tx);
            });
            totalProcessed += 1;
            continue;
          }

          await prisma.$transaction(async (tx) => {
            await dispatchOtherFinancialRow(
              store.id,
              store.organizationId,
              transactionType,
              row,
              tx,
            );
          });
          totalProcessed += 1;
        } catch (err) {
          syncLog.error('settlements.dispatch.failed', {
            syncLogId: log.id,
            storeId: store.id,
            rowId: row.id,
            transactionType,
            chunkIdx,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // End-of-cycle reconciliation status bump — escalate NOT_SETTLED orders
  // with any SETTLEMENT OrderFee to PARTIALLY_SETTLED. FULLY_SETTLED rows
  // (handlePaymentOrderEntry's own writes) are preserved (NOT_SETTLED
  // filter on updateMany).
  await prisma.$transaction(async (tx) => {
    await bumpReconciliationStatusForStore(store.id, tx);
  });

  syncLog.info('settlements.chunk.done', {
    syncLogId: log.id,
    storeId: store.id,
    totalProcessed,
  });

  return { kind: 'done', finalCount: totalProcessed };
}

export const settlementsHandler: ModuleHandler = { processChunk: processSettlementsChunk };
