// Trendyol PRODUCTS_CHANGES handler: the hourly date-window walk of the
// approved product list. One chunk = one page of one phase.
//
// What it catches between the nightly full PRODUCTS scans: new products, and
// status / metadata changes (lock, archive, title, images, desi, commission,
// VAT, delivery duration). Stock and price stay with the hourly PRODUCTS_DELTA,
// because a stock change does not advance Trendyol's modified dates.
//
// Run shape:
//   1. First chunk (no cursor yet): compute the change window from this run's
//      startedAt and the startedAt of the store's last COMPLETED
//      PRODUCTS_CHANGES run (else last COMPLETED PRODUCTS full scan); see
//      products-changes-window.ts. No window -> the run finishes empty. A
//      window is persisted as the cursor { first phase, page 0 } BEFORE any
//      vendor call, so every later chunk, retry and re-claim of this row
//      queries exactly the same range.
//   2. Every later chunk fetches one page of the cursor's phase
//      (PRODUCTS_CHANGES_PHASES order, from @pazarsync/sync-core) and writes
//      the returned products through upsertCatalogBatch, the full scan's
//      write path (which also refreshes the product aggregates in the same
//      transaction). An empty page or the phase's last page moves on to the
//      next phase at page 0; after the last phase the run completes.
//
// Writes and lastSyncedAt: only the products Trendyol returned are written,
// so lastSyncedAt is stamped only on variants Trendyol just returned as
// approved, which are listed by definition. That keeps the full scan's
// absence-from-feed delist pass correct. This handler NEVER sets delistedAt;
// the upsert clears it on a returned variant, and marking a variant absent
// stays owned by the full scan, the only pass that sees the whole catalog.
// Every write is scoped to the job's organizationId and storeId: the store is
// loaded by both, and upsertCatalogBatch keys every row on that store.
//
// Over the cap: Trendyol pages by `page` only up to 10,000 items. A phase whose
// page 0 reports more than that (a bulk change) is not walked at all: the run
// logs products-changes.window-over-cap, writes nothing from that page and
// completes, skipping the remaining phases; the nightly full scan covers it.
//
// Failure: the skip-bad-page recovery is NOT offered for this type (see
// run-error.ts). A failed run never moves the window, because the anchor only
// reads COMPLETED runs, so the next hourly run rescans the same range.
//
// Known and accepted: the result order is not by date, so an item that drops
// out of the result set mid-walk shifts the later items up one page, and the
// walk can miss one. Every phase queries up to windowEnd plus the end allowance
// (PRODUCTS_CHANGES_END_ALLOWANCE_MS, 3 h), so with true-UTC stamps a product
// modified again during a walk shorter than that stays in range. An item drops
// out only when its new stamp passes windowEnd plus the allowance (for example
// Istanbul wall-clock time stamped as UTC, where any change after windowEnd
// does) or when the product leaves the approved list. Items entering the range
// mid-walk only make the walk re-read a row, which is idempotent. A missed
// item is caught by the next window (which starts at this run's startedAt
// minus the safety margin) or by the nightly scan.
//
// The fetcher maps a 404 on a date page to an empty page flagged notFound. The
// handler treats it like any empty page but logs products-changes.page-not-
// found: stage answers an empty window with 200, so a seller whose every date
// query 404s would otherwise complete quietly every hour while the anchor
// moves forward.

import { upsertCatalogBatch } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';
import {
  APPROVED_PAGE_CAP_ITEMS,
  decryptStoreCredentials,
  fetchApprovedProductsPageByDate,
  PRODUCTS_PAGE_SIZE,
} from '@pazarsync/marketplace';
import {
  nextProductsChangesPhase,
  parseProductsChangesCursor,
  PRODUCTS_CHANGES_PHASES,
  syncLog,
  syncLogService,
  type ProductsChangesCursor,
} from '@pazarsync/sync-core';

import {
  computeProductsChangesQueryRange,
  computeProductsChangesWindow,
} from './products-changes-window';
import type { ChunkResult, ModuleHandler } from './types';

const FIRST_PHASE = PRODUCTS_CHANGES_PHASES[0];

// Progress stage labels (SyncLog.progressStage).
const STAGE_WINDOW = 'window';
const STAGE_UPSERTING = 'upserting';

// First chunk: anchor the window and persist it as the cursor, or finish empty
// when there is no window. Fetches nothing.
async function startRun(log: SyncLog): Promise<ChunkResult> {
  const [lastChangesRunStartedAt, lastFullScanStartedAt] = await Promise.all([
    syncLogService.getLastCompletedRunStartedAt(
      log.organizationId,
      log.storeId,
      'PRODUCTS_CHANGES',
    ),
    syncLogService.getLastCompletedRunStartedAt(log.organizationId, log.storeId, 'PRODUCTS'),
  ]);

  const window = computeProductsChangesWindow({
    runStartedAtMs: log.startedAt.getTime(),
    lastChangesRunStartedAtMs: lastChangesRunStartedAt?.getTime() ?? null,
    lastFullScanStartedAtMs: lastFullScanStartedAt?.getTime() ?? null,
  });

  if (window === null) {
    syncLog.info('products-changes.no-window', {
      syncLogId: log.id,
      storeId: log.storeId,
      runStartedAt: log.startedAt.getTime(),
      lastChangesRunStartedAt: lastChangesRunStartedAt?.getTime() ?? null,
      lastFullScanStartedAt: lastFullScanStartedAt?.getTime() ?? null,
    });
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const cursor: ProductsChangesCursor = { phase: FIRST_PHASE, page: 0, ...window };
  syncLog.info('products-changes.window', {
    syncLogId: log.id,
    storeId: log.storeId,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    anchor: lastChangesRunStartedAt !== null ? 'PRODUCTS_CHANGES' : 'PRODUCTS',
  });

  return {
    kind: 'continue',
    cursor,
    progress: log.progressCurrent,
    total: null,
    stage: STAGE_WINDOW,
  };
}

// Terminal for a window this path cannot page through: Trendyol's page-based
// paging stops at 10,000 items. Completes the run (remaining phases skipped)
// instead of failing it, so the window still moves on; the nightly full scan
// covers the bulk change.
function finishOverCap(
  log: SyncLog,
  cursor: ProductsChangesCursor,
  totalElements: number | null,
): ChunkResult {
  syncLog.warn('products-changes.window-over-cap', {
    syncLogId: log.id,
    storeId: log.storeId,
    phase: cursor.phase,
    page: cursor.page,
    totalElements,
    capItems: APPROVED_PAGE_CAP_ITEMS,
    pageSize: PRODUCTS_PAGE_SIZE,
    windowStart: cursor.windowStart,
    windowEnd: cursor.windowEnd,
    progress: log.progressCurrent,
  });
  return { kind: 'done', finalCount: log.progressCurrent };
}

// Where the walk goes after this page: the next page of the same phase, page 0
// of the next phase once this one ended, or null after the last phase (done).
function advanceCursor(
  cursor: ProductsChangesCursor,
  phaseEnded: boolean,
): ProductsChangesCursor | null {
  if (!phaseEnded) return { ...cursor, page: cursor.page + 1 };
  const nextPhase = nextProductsChangesPhase(cursor.phase);
  return nextPhase === null ? null : { ...cursor, phase: nextPhase, page: 0 };
}

export async function processProductsChangesChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const cursor = parseProductsChangesCursor(input.cursor);

  if (cursor === null) return startRun(log);

  syncLog.info('products-changes.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    progressCurrent: log.progressCurrent,
  });

  // This page would reach past the 10,000-item cap. Only possible when the
  // result set grew mid-walk (page 0 already rejected an over-cap window), or
  // from a corrupt cursor; never ask Trendyol for it.
  if ((cursor.page + 1) * PRODUCTS_PAGE_SIZE > APPROVED_PAGE_CAP_ITEMS) {
    return finishOverCap(log, cursor, null);
  }

  const store = await prisma.store.findFirstOrThrow({
    where: { id: log.storeId, organizationId: log.organizationId },
  });
  const credentials = decryptStoreCredentials(store);
  const range = computeProductsChangesQueryRange(cursor);

  const { batch, pageMeta, notFound } = await fetchApprovedProductsPageByDate({
    environment: store.environment,
    credentials,
    dateQueryType: cursor.phase,
    startDate: range.startDate,
    endDate: range.endDate,
    page: cursor.page,
  });

  if (notFound) {
    syncLog.warn('products-changes.page-not-found', {
      syncLogId: log.id,
      storeId: log.storeId,
      phase: cursor.phase,
      page: cursor.page,
    });
  }

  if (cursor.page === 0 && pageMeta.totalElements > APPROVED_PAGE_CAP_ITEMS) {
    return finishOverCap(log, cursor, pageMeta.totalElements);
  }

  if (batch.length > 0) {
    await upsertCatalogBatch(store, batch, log.id);
  }

  // Counts written products; one returned by several phases counts each time.
  const newProgress = log.progressCurrent + batch.length;

  const phaseEnded = batch.length === 0 || cursor.page >= pageMeta.totalPages - 1;
  const nextCursor = advanceCursor(cursor, phaseEnded);

  syncLog.info('products-changes.chunk.complete', {
    syncLogId: log.id,
    phase: cursor.phase,
    page: cursor.page,
    pageBatchSize: batch.length,
    totalElements: pageMeta.totalElements,
    newProgress,
    nextCursor,
  });

  if (nextCursor === null) return { kind: 'done', finalCount: newProgress };

  // total stays null: each phase has its own totalElements, so a known total
  // would reset the progress bar at every phase switch.
  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: null,
    stage: STAGE_UPSERTING,
  };
}

export const productsChangesHandler: ModuleHandler = { processChunk: processProductsChangesChunk };
