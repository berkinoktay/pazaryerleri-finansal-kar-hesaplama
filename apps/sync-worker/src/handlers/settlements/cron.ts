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
// 6h tick / 60d window overlap is ~59.75d. The raw-record store is idempotent
// on (store_id, family, record_id) (ingestFinanceRecords' ON CONFLICT DO
// UPDATE), so a re-polled row updates its existing row instead of duplicating.
//
// Phase 3B: every fetched row is stored verbatim as a marketplace_finance_record
// and the orders it binds to are enqueued for a profit recompute. The legacy
// per-row handlers (dispatchSettlementRow / dispatchOtherFinancialRow /
// handleCargoInvoiceItems) and the end-of-cycle reconciliation bump are no longer
// called; their files stay until phase 5.
//
// Phase 3D pruning: the raw store is keyed by (store_id, family, record_id), and
// Trendyol renews record ids (it did on 3 Aug 2026), so a renewed id lands as a second
// row and the same sale is counted twice. After all slices, each scanned type whose scan
// came back complete (yielded >= totalElements over every slice) and fully in window is
// pruned: pruneUnseenFinanceRecords deletes the stored rows the scan no longer returned
// and enqueues their orders. A short scan (settlements.prune.skipped INCOMPLETE_SCAN) or a
// row dated outside its slice window (OUT_OF_WINDOW_ROW) prunes nothing; cargo invoice
// items are never pruned (their key is the invoice serial, not a renewable record id). A
// thrown fetch error still fails the whole job as before, so no pruning runs on a bad scan.
//
// Resilience: settlement and otherfinancials rows ingest in batches of
// FINANCE_INGEST_BATCH_SIZE per transaction; a failed batch is retried row by row so one
// malformed row logs + skips while the rest of the batch survives. A cargo invoice keeps
// its own one-transaction-per-invoice path (its item fan-out would bloat a batch). A
// heartbeat follows every batch. orders.ts pattern mirror.
//
// Dependency injection: `fetchers` parameter accepts mock fetchers in
// tests; production calls use the @pazarsync/marketplace defaults.

import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';
import { FinanceRecordFamily } from '@pazarsync/db/enums';
import {
  decryptStoreCredentials,
  fetchAllCargoInvoiceItems,
  fetchOtherFinancials,
  fetchSettlements,
  FINANCIAL_WINDOW_MAX_DAYS,
  getCargoInvoiceSerial,
  isCompleteFinancialScan,
  type CargoInvoiceItem,
  type FetchCargoInvoiceItemsOpts,
  type FetchOtherFinancialsOpts,
  type FetchSettlementsOpts,
  type FinancialScanSummary,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import {
  type FinanceRecordInput,
  ingestFinanceRecords,
  pruneUnseenFinanceRecords,
  trendyolCargoInvoiceItemInputs,
  trendyolOtherFinancialRecordInput,
  trendyolSettlementRecordInput,
} from '@pazarsync/profit';
import { syncLog, syncLogService } from '@pazarsync/sync-core';
import { computeOrdersCutoffMs } from '../orders';
import type { ChunkResult, ModuleHandler } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCAN_WINDOW_DAYS = 60;

// Interactive-transaction budgets for a single raw-record ingest. Prisma's 5s default
// is too tight for the store + resolve + enqueue that ingestFinanceRecords runs, so each
// ingest sets both explicitly.
const INGEST_TX_MAX_WAIT_MS = 10_000;
const INGEST_TX_TIMEOUT_MS = 30_000;
// A cargo invoice can carry ~500 items, all stored in one transaction, so its ingest gets
// a wider timeout than a single settlement/otherfinancials row.
const CARGO_INVOICE_TX_TIMEOUT_MS = 60_000;
// Settlement and otherfinancials rows ingest this many per transaction. A high-volume
// store can return thousands of rows per window; one ingest per row would open thousands
// of transactions. Cargo-invoice rows are excluded; they keep their own per-invoice path.
const FINANCE_INGEST_BATCH_SIZE = 200;

// One day of slack around the scan edges when deciding what to prune. Trendyol stamps
// dates in Istanbul time as if they were UTC, so a row can read a few hours off from the
// filter window we requested; that shift must not trip the per-row window guard. The same
// one-day pad keeps the delete range (overallStartTime + pad, endDate - pad) one day
// inside both scan edges, so a vendor filter that is itself shifted can never delete a row
// it did not actually consider. See [[feedback_trendyol_orderdate_local_as_utc]].
const FINANCE_PRUNE_EDGE_TOLERANCE_MS = 86_400_000;

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
  ) => AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary>;
  fetchOtherFinancials: (
    opts: FetchOtherFinancialsOpts,
  ) => AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary>;
  /** PR-8: kargo faturasi item'lari — cron tx DISINDA ceker (ag cagrisi). */
  fetchCargoInvoiceItems: (opts: FetchCargoInvoiceItemsOpts) => Promise<CargoInvoiceItem[]>;
}

const DEFAULT_FETCHERS: SettlementsFetchers = {
  fetchSettlements,
  fetchOtherFinancials,
  fetchCargoInvoiceItems: fetchAllCargoInvoiceItems,
};

/** A fetched finance row buffered for batch ingest, with the context a per-row log needs. */
interface BufferedFinanceRow {
  readonly input: FinanceRecordInput;
  readonly rowId: string;
  readonly transactionType: string;
}

/**
 * One scanned (family, transactionType)'s pruning state, aggregated across every window
 * slice. `seen` is every record id the scan returned (so a stored row NOT in it is a
 * stale candidate); `complete` is the AND of every slice's completeness; `inWindow` is
 * false once any returned row carried a date outside its slice window (plus tolerance).
 * Only a complete, in-window scan may prune.
 */
interface FinancialScanState {
  readonly family: FinanceRecordFamily;
  readonly transactionType: string;
  readonly seen: Set<string>;
  complete: boolean;
  inWindow: boolean;
}

/**
 * Drains one scan generator through `next()` (not `for await`) so its RETURN value — the
 * FinancialScanSummary — is read, calling `onRow` for every yielded row. The caller keeps
 * its batching/flush exactly as before inside `onRow`.
 */
async function consumeFinancialScan(
  generator: AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary>,
  onRow: (row: TrendyolFinancialTransaction) => Promise<void>,
): Promise<FinancialScanSummary> {
  let next = await generator.next();
  while (next.done !== true) {
    await onRow(next.value);
    next = await generator.next();
  }
  return next.value;
}

/**
 * Records one fetched row against its type's scan state: its id joins `seen` (even if the
 * ingest later fails, because a renewed id the vendor still returns is not stale), and
 * `inWindow` is cleared if the row's transactionDate falls outside its slice window padded
 * by FINANCE_PRUNE_EDGE_TOLERANCE_MS on each side.
 */
function recordScanRow(
  state: FinancialScanState,
  row: TrendyolFinancialTransaction,
  chunkStart: Date,
  chunkEnd: Date,
): void {
  state.seen.add(row.id);
  const lowerMs = chunkStart.getTime() - FINANCE_PRUNE_EDGE_TOLERANCE_MS;
  const upperMs = chunkEnd.getTime() + FINANCE_PRUNE_EDGE_TOLERANCE_MS;
  if (row.transactionDate < lowerMs || row.transactionDate > upperMs) {
    state.inWindow = false;
  }
}

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
  input: { syncLog: SyncLog; cursor: unknown | null; workerId: string },
  fetchers: SettlementsFetchers = DEFAULT_FETCHERS,
): Promise<ChunkResult> {
  const { syncLog: log, workerId } = input;

  syncLog.info('settlements.chunk.start', { syncLogId: log.id, storeId: log.storeId });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  const endDate = new Date();
  // Overall scan start clamps to the same cutoff the orders backfill uses
  // (computeOrdersCutoffMs) instead of a bare store.createdAt. In production
  // (SYNC_HISTORICAL_BACKFILL_DAYS=0) that cutoff IS store.createdAt, so the
  // behavior is unchanged: a store connected less than 60 days ago has no
  // transactions dated before it existed, and requesting slices before the
  // cutoff only burns vendor quota on guaranteed-empty windows. In dev/stage
  // with a positive backfill the settlement scan honors the same historical
  // window as the orders it reconciles (env.ts documents this escape hatch).
  // The write layer's order_not_found skips remain the correctness net if the
  // clamp is ever too generous.
  const overallStartTime = Math.max(
    endDate.getTime() - SCAN_WINDOW_DAYS * MS_PER_DAY,
    computeOrdersCutoffMs({ storeCreatedAt: store.createdAt, endDate: endDate.getTime() }),
  );
  const chunkCount = Math.ceil(SCAN_WINDOW_DAYS / FINANCIAL_WINDOW_MAX_DAYS);

  let totalProcessed = 0;

  // Pruning state per scanned (family, transactionType), aggregated across every slice.
  // CARGO_INVOICE_ITEM never gets a state here, so cargo items are never pruned.
  const scanStates = new Map<string, FinancialScanState>();
  const scanStateFor = (
    family: FinanceRecordFamily,
    transactionType: string,
  ): FinancialScanState => {
    const key = `${family}:${transactionType}`;
    const existing = scanStates.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: FinancialScanState = {
      family,
      transactionType,
      seen: new Set<string>(),
      complete: true,
      inWindow: true,
    };
    scanStates.set(key, created);
    return created;
  };

  // Ingest one buffered batch in a single transaction, counting its rows into
  // totalProcessed. On any failure, log once (settlements.ingest.batch-failed) and retry
  // the rows one by one in their own transactions, so a single bad row (e.g. a numeric
  // overflow) never drops the rest of the batch. A heartbeat follows every batch.
  const flushBatch = async (rows: BufferedFinanceRow[], chunkIdx: number): Promise<void> => {
    if (rows.length === 0) {
      return;
    }
    try {
      await prisma.$transaction(
        (tx) =>
          ingestFinanceRecords(tx, {
            organizationId: store.organizationId,
            storeId: store.id,
            platform: store.platform,
            records: rows.map((row) => row.input),
          }),
        { maxWait: INGEST_TX_MAX_WAIT_MS, timeout: INGEST_TX_TIMEOUT_MS },
      );
      totalProcessed += rows.length;
    } catch (batchErr) {
      syncLog.error('settlements.ingest.batch-failed', {
        syncLogId: log.id,
        storeId: store.id,
        chunkIdx,
        batchSize: rows.length,
        errorMessage: batchErr instanceof Error ? batchErr.message : String(batchErr),
      });
      for (const row of rows) {
        try {
          await prisma.$transaction(
            (tx) =>
              ingestFinanceRecords(tx, {
                organizationId: store.organizationId,
                storeId: store.id,
                platform: store.platform,
                records: [row.input],
              }),
            { maxWait: INGEST_TX_MAX_WAIT_MS, timeout: INGEST_TX_TIMEOUT_MS },
          );
          totalProcessed += 1;
        } catch (rowErr) {
          syncLog.error('settlements.dispatch.failed', {
            syncLogId: log.id,
            storeId: store.id,
            rowId: row.rowId,
            transactionType: row.transactionType,
            chunkIdx,
            errorMessage: rowErr instanceof Error ? rowErr.message : String(rowErr),
          });
        }
      }
    }
    await syncLogService.heartbeat(log.id, workerId);
  };

  // Slide newest → oldest in FINANCIAL_WINDOW_MAX_DAYS slices. Oldest chunk
  // start is clamped to overallStartTime so non-divisible SCAN_WINDOW_DAYS
  // values (e.g. 50d / 15d → 4 chunks but the 4th is 5d) still respect the
  // configured scan window.
  for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx += 1) {
    const chunkEndMs = endDate.getTime() - chunkIdx * FINANCIAL_WINDOW_MAX_DAYS * MS_PER_DAY;
    // A slice whose end is at/before overallStartTime falls entirely before
    // store.createdAt (fresh store). Chunks march monotonically older, so once
    // one is fully out of range every later chunk is too — stop requesting.
    if (chunkEndMs <= overallStartTime) {
      break;
    }

    // Heartbeat: this handler is single-chunk (never ticks via loop.ts),
    // and a full 60d scan can outlive the 90s stale-claim watchdog —
    // stamp lastTickAt once per window slice so a live scan is never
    // reaped and re-run concurrently by a peer worker.
    await syncLogService.heartbeat(log.id, workerId);

    const chunkStartMs = Math.max(
      chunkEndMs - FINANCIAL_WINDOW_MAX_DAYS * MS_PER_DAY,
      overallStartTime,
    );
    const chunkEnd = new Date(chunkEndMs);
    const chunkStart = new Date(chunkStartMs);

    for (const transactionType of SETTLEMENT_TYPES) {
      await syncLogService.heartbeat(log.id, workerId);
      const state = scanStateFor(FinanceRecordFamily.SETTLEMENT, transactionType);
      const generator = fetchers.fetchSettlements({
        environment: store.environment,
        credentials,
        transactionType,
        startDate: chunkStart,
        endDate: chunkEnd,
      });
      const batch: BufferedFinanceRow[] = [];
      const summary = await consumeFinancialScan(generator, async (row) => {
        recordScanRow(state, row, chunkStart, chunkEnd);
        batch.push({
          input: trendyolSettlementRecordInput(transactionType, row),
          rowId: row.id,
          transactionType,
        });
        if (batch.length >= FINANCE_INGEST_BATCH_SIZE) {
          await flushBatch(batch.splice(0), chunkIdx);
        }
      });
      await flushBatch(batch.splice(0), chunkIdx);
      state.complete = state.complete && isCompleteFinancialScan(summary);
    }

    for (const transactionType of OTHER_FINANCIAL_TYPES) {
      await syncLogService.heartbeat(log.id, workerId);
      const state = scanStateFor(FinanceRecordFamily.OTHER_FINANCIAL, transactionType);
      const generator = fetchers.fetchOtherFinancials({
        environment: store.environment,
        credentials,
        transactionType,
        startDate: chunkStart,
        endDate: chunkEnd,
      });
      const batch: BufferedFinanceRow[] = [];
      const summary = await consumeFinancialScan(generator, async (row) => {
        // The invoice row itself is an OTHER_FINANCIAL/DeductionInvoices record, so its id
        // joins this type's seen set (it can be pruned); its cargo items are a separate
        // CARGO_INVOICE_ITEM family that is never pruned, so they are not tracked here.
        recordScanRow(state, row, chunkStart, chunkEnd);
        // A cargo-invoice (Kargo Fatura) DeductionInvoices row: fetch its items over the
        // network FIRST (outside the transaction), then store the invoice row itself and
        // every one of its items in ONE transaction. An invoice can carry ~500 items, so
        // this ingest keeps its own path and the wider timeout; it never joins a batch.
        const cargoSerial = getCargoInvoiceSerial(transactionType, row);
        if (cargoSerial !== null) {
          try {
            const items = await fetchers.fetchCargoInvoiceItems({
              environment: store.environment,
              credentials,
              invoiceSerialNumber: cargoSerial,
            });
            await prisma.$transaction(
              (tx) =>
                ingestFinanceRecords(tx, {
                  organizationId: store.organizationId,
                  storeId: store.id,
                  platform: store.platform,
                  records: [
                    trendyolOtherFinancialRecordInput(transactionType, row),
                    ...trendyolCargoInvoiceItemInputs(row, items),
                  ],
                }),
              { maxWait: INGEST_TX_MAX_WAIT_MS, timeout: CARGO_INVOICE_TX_TIMEOUT_MS },
            );
            // One source row processed: the invoice counts once, its items ride along.
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
          return;
        }

        batch.push({
          input: trendyolOtherFinancialRecordInput(transactionType, row),
          rowId: row.id,
          transactionType,
        });
        if (batch.length >= FINANCE_INGEST_BATCH_SIZE) {
          await flushBatch(batch.splice(0), chunkIdx);
        }
      });
      await flushBatch(batch.splice(0), chunkIdx);
      state.complete = state.complete && isCompleteFinancialScan(summary);
    }
  }

  // Prune stale raw rows a complete scan no longer returned. The delete range sits one
  // tolerance inside both scan edges so a shifted vendor filter can never delete a row it
  // did not consider; an empty range (a freshly connected store whose whole window is
  // narrower than two tolerances) prunes nothing and logs nothing.
  const pruneWindowStart = new Date(overallStartTime + FINANCE_PRUNE_EDGE_TOLERANCE_MS);
  const pruneWindowEnd = new Date(endDate.getTime() - FINANCE_PRUNE_EDGE_TOLERANCE_MS);
  if (pruneWindowStart.getTime() < pruneWindowEnd.getTime()) {
    for (const state of scanStates.values()) {
      if (!state.complete || !state.inWindow) {
        // A short scan or an out-of-window row means we cannot be sure a stored row is
        // stale; leave every stored row of this type untouched.
        syncLog.warn('settlements.prune.skipped', {
          syncLogId: log.id,
          storeId: store.id,
          family: state.family,
          transactionType: state.transactionType,
          reason: state.complete ? 'OUT_OF_WINDOW_ROW' : 'INCOMPLETE_SCAN',
        });
        continue;
      }
      await syncLogService.heartbeat(log.id, workerId);
      const { pruned, enqueuedOrders } = await prisma.$transaction(
        (tx) =>
          pruneUnseenFinanceRecords(tx, {
            organizationId: store.organizationId,
            storeId: store.id,
            family: state.family,
            transactionType: state.transactionType,
            windowStart: pruneWindowStart,
            windowEnd: pruneWindowEnd,
            seenRecordIds: [...state.seen],
          }),
        { maxWait: INGEST_TX_MAX_WAIT_MS, timeout: INGEST_TX_TIMEOUT_MS },
      );
      syncLog.info('settlements.prune.done', {
        syncLogId: log.id,
        storeId: store.id,
        family: state.family,
        transactionType: state.transactionType,
        pruned,
        enqueuedOrders,
      });
    }
  }

  syncLog.info('settlements.chunk.done', {
    syncLogId: log.id,
    storeId: store.id,
    totalProcessed,
  });

  return { kind: 'done', finalCount: totalProcessed };
}

export const settlementsHandler: ModuleHandler = { processChunk: processSettlementsChunk };
