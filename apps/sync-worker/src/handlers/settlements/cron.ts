// Settlement cron module handler (PR-7 commit 8).
//
// One chunk = one full settlement window scan (3 settlements transactionTypes
// + 3 otherfinancials types). Single-chunk semantics chosen because:
//   - 15-day window total volume << orders epic's 90-day backfill
//   - Per-row $transaction isolation already gives partial-fail recovery
//   - Cursor-resume per-page complexity defers V2 scaling work
//
// Cron cadence (design §5.5 line 1139-1140):
//   - Settlement scan: 6 saat / 15 gün window
//   - Settlement re-poll (PR-12): same scan, surfaces orphan paymentOrderId
//
// 6h tick / 15d window overlap is ~14.75d. Handlers' idempotency anchors
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
import type { Store, SyncLog } from '@pazarsync/db';
import {
  fetchOtherFinancials,
  fetchSettlements,
  isTrendyolCredentials,
  type FetchOtherFinancialsOpts,
  type FetchSettlementsOpts,
  type TrendyolCredentials,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { decryptCredentials, syncLog } from '@pazarsync/sync-core';

import { bumpReconciliationStatusForStore } from './status-bump';
import { dispatchOtherFinancialRow, dispatchSettlementRow } from './dispatcher';
import type { ChunkResult, ModuleHandler } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCAN_WINDOW_DAYS = 15;

// V1 happy path — research §3.3 confirmed only Sale/Discount/Return have
// nonzero observations in 60-day windows. Rare types stay enumerated in
// dispatcher.ts (audit log fall-through) but the cron loop skips them
// for now to reduce API calls. They'll surface naturally once stage
// produces concrete rows (PR-N follow-up).
const SETTLEMENT_TYPES = ['Sale', 'Discount', 'Return'] as const;
const OTHER_FINANCIAL_TYPES = ['PaymentOrder', 'Stoppage', 'DeductionInvoices'] as const;

function decryptStoreCredentials(store: Store): TrendyolCredentials {
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new Error('Invalid Trendyol credentials shape on store');
  }
  return decrypted;
}

// ─── DI shape for fetchers (test-mockable) ──────────────────────────────

export interface SettlementsFetchers {
  fetchSettlements: (
    opts: FetchSettlementsOpts,
  ) => AsyncGenerator<TrendyolFinancialTransaction, void>;
  fetchOtherFinancials: (
    opts: FetchOtherFinancialsOpts,
  ) => AsyncGenerator<TrendyolFinancialTransaction, void>;
}

const DEFAULT_FETCHERS: SettlementsFetchers = {
  fetchSettlements,
  fetchOtherFinancials,
};

// ─── Handler ─────────────────────────────────────────────────────────────

/**
 * Process one full settlement cycle for a store.
 *
 * Cursor: unused. Settlement window is always "now − 15d → now" — re-poll
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
  const startDate = new Date(endDate.getTime() - SCAN_WINDOW_DAYS * MS_PER_DAY);

  let totalProcessed = 0;

  for (const transactionType of SETTLEMENT_TYPES) {
    const generator = fetchers.fetchSettlements({
      environment: store.environment,
      credentials,
      transactionType,
      startDate,
      endDate,
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
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  for (const transactionType of OTHER_FINANCIAL_TYPES) {
    const generator = fetchers.fetchOtherFinancials({
      environment: store.environment,
      credentials,
      transactionType,
      startDate,
      endDate,
    });
    for await (const row of generator) {
      try {
        await prisma.$transaction(async (tx) => {
          await dispatchOtherFinancialRow(store.id, store.organizationId, transactionType, row, tx);
        });
        totalProcessed += 1;
      } catch (err) {
        syncLog.error('settlements.dispatch.failed', {
          syncLogId: log.id,
          storeId: store.id,
          rowId: row.id,
          transactionType,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
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
