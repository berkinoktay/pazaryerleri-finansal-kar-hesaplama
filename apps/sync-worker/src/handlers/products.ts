// Trendyol products module handler — one chunk = one Trendyol page.
//
// Compared to the legacy `apps/api/src/services/product-sync.service.ts` which
// streams every page of a sync inside a single async-but-not-awaited function,
// this handler processes ONE page per invocation and returns a cursor the
// dispatcher writes to `SyncLog.pageCursor`. The next chunk picks up exactly
// where this one stopped, so a crash or a redeploy mid-sync loses at most one
// page of work and never re-runs already-upserted pages.
//
// The catalog write pipeline (`upsertCatalogBatch`, formerly `upsertBatch`
// here) lives in `@pazarsync/catalog-sync` since the 2026-06-12 PR-2 promotion
// (third consumer: the webhook's eager catalog repair). This handler only
// drives pagination and delegates every write to the package.

import { refreshProductAggregates, upsertCatalogBatch } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { Prisma, SyncLog } from '@pazarsync/db';
import {
  APPROVED_PAGE_CAP_ITEMS,
  decryptStoreCredentials,
  fetchApprovedProducts,
  PRODUCTS_PAGE_SIZE,
} from '@pazarsync/marketplace';
import {
  parseProductsCursor,
  parseSkippedPages,
  syncLog,
  syncLogService,
  type ProductsCursor,
  type SkippedPageEntry,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

// Trendyol getApprovedProducts pagination contract (per
// docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md §3):
//
//   - Default: request?page=N&size=PRODUCTS_PAGE_SIZE — works while
//     page * size ≤ 10,000 (APPROVED_PAGE_CAP_ITEMS).
//   - nextPageToken: required ONLY past the cap.
//
// Trendyol's API has been observed to return 500 deterministically on
// specific nextPageToken values mid-stream (real upstream issue, sample
// repro: token "eyJzb3J0IjpbMTc2MDk2MTM2NzAwMF19" on a 5,624-product
// catalog). Page-based pagination walks past the bad token. Token
// cursors are kept in reserve for catalogs > 10k where they're
// actually required.
//
// PRODUCTS_PAGE_SIZE / APPROVED_PAGE_CAP_ITEMS imported from the
// marketplace package — single source of truth so the worker's
// token→page fallback math stays consistent with the fetcher.

// Which terminal ('done') branch reached completion. The handler has four
// physical `kind: 'done'` returns; the delist pass must run on the three that
// prove the catalog was fully scanned and MUST be skipped on the truncation
// one, which proves nothing about absence past Trendyol's 10k page cap.
//
//   - 'empty-page'         generator finished / yielded no value (catalog exhausted)
//   - 'empty-batch'        the page came back with an empty batch (catalog exhausted)
//   - 'reached-end'        newProgress >= totalElements OR the last documented page
//   - 'truncated-past-cap' past the 10k cap with no nextPageToken — tail unscanned
export type DelistDoneReason = 'empty-page' | 'empty-batch' | 'reached-end' | 'truncated-past-cap';

// Why a complete-looking done was NOT trusted enough to run the delist pass.
// Surfaced as the `reason` field of 'products.delist-pass-skipped' so an
// operator can tell a deliberate skip from a bug.
//   - 'skipped-pages'        skip-bad-page recovery dropped a page this run
//   - 'truncated-past-cap'   the scan stopped past the 10k cap with no token
//   - 'untrusted-empty-scan' the scan ended empty without having walked any real
//                            page AND the vendor did not confirm an empty catalog
export type DelistSkipReason = 'skipped-pages' | 'truncated-past-cap' | 'untrusted-empty-scan';

// The outcome of the delist decision: run, or skip with a named reason.
export type DelistDecision = { run: true } | { run: false; reason: DelistSkipReason };

// What this run observed, threaded into the decision so the empty-done reasons
// are trusted only when the emptiness is real.
export interface DelistScanContext {
  // Items upserted across this run so far (SyncLog.progressCurrent). > 0 means
  // at least one real page was walked before the empty terminal was reached.
  progressCurrent: number;
  // totalElements from the page this chunk actually observed, or null when no
  // page was observed (the generator returned done/undefined before yielding).
  observedTotalElements: number | null;
}

// Pure decision: may the absence-from-feed delist pass run for this done? Only
// when the scan was COMPLETE and its terminal state is trustworthy.
//
// Incompleteness that leaves still-listed variants unseen (never run):
//   (a) skip-bad-page recovery dropped a page (skippedPages non-empty) — the
//       variants on that page were never returned by this run.
//   (b) the scan truncated past Trendyol's 10k page cap with no token — the
//       tail of the catalog was never fetched.
//
// Untrustworthy emptiness (never run): an 'empty-page'/'empty-batch' terminal is
// proof of an exhausted catalog ONLY when we actually walked pages this run
// (progressCurrent > 0) OR the vendor explicitly reported an empty catalog
// (observedTotalElements === 0). An empty FIRST response over a nonzero catalog
// is a transient vendor blip; running the pass there would mass-delist the whole
// catalog, because no page of this run refreshed lastSyncedAt, so nearly every
// variant still carries a timestamp older than this run's startedAt (only the
// few that an hourly PRODUCTS_CHANGES page or a barcode repair returned since
// then would be spared).
//
// Exhaustive over DelistDoneReason so a future done branch forces a decision.
export function shouldRunDelistPass(
  skippedPages: SkippedPageEntry[],
  doneReason: DelistDoneReason,
  scan: DelistScanContext,
): DelistDecision {
  if (skippedPages.length > 0) return { run: false, reason: 'skipped-pages' };
  switch (doneReason) {
    case 'reached-end':
      return { run: true };
    case 'empty-page':
    case 'empty-batch':
      if (scan.progressCurrent > 0 || scan.observedTotalElements === 0) {
        return { run: true };
      }
      return { run: false, reason: 'untrusted-empty-scan' };
    case 'truncated-past-cap':
      return { run: false, reason: 'truncated-past-cap' };
    default: {
      const _exhaustive: never = doneReason;
      throw new Error(`Unhandled delist done reason: ${_exhaustive}`);
    }
  }
}

// The delist pass stamps and re-aggregates its candidates in chunks of this many
// variants, one transaction per chunk, so a mass delist (a seller removing
// thousands of listings at once) never builds one unbounded IN list or one
// transaction spanning the whole store. Kept small because a chunk holds the
// row locks of up to this many products (webhook order intakes on them wait)
// and re-aggregates them with one UPDATE each.
const DELIST_CHUNK_SIZE = 200;

// Prisma's default interactive-transaction timeout (5s) is too tight for a chunk
// against a remote database, so the chunk transaction gets an explicit budget.
// It stays well below the watchdog's 90s stale-claim threshold: the pass
// heartbeats before its first chunk and after every chunk, so the gap between
// two heartbeats is one chunk (plus the candidate read, for the first one).
const DELIST_CHUNK_TX_TIMEOUT_MS = 30_000;

// Absence-from-feed delisting, run right before a complete-done return. Factored
// out of the multi-done-path handler so every complete branch calls the exact
// same pass and the truncation branch is the only one that skips it (via the
// decision above).
//
// Correctness: every writer of `lastSyncedAt` is an approved-products read
// through the catalog upsert (upsertCatalogBatch): a page of this full scan, an
// hourly PRODUCTS_CHANGES page, or a barcode repair (ensureBarcodesInCatalog).
// The hourly stock+price delta deliberately does NOT touch it. So "lastSyncedAt
// >= startedAt" means Trendyol returned the variant as listed at some moment
// after this scan began, and "lastSyncedAt older than this scan's startedAt"
// means no approved read returned it since then; in particular, no page of this
// complete scan returned it. Every variant a page of this scan returned had its
// lastSyncedAt refreshed to now() (> startedAt) and is excluded.
//
// Known effect: a variant that PRODUCTS_CHANGES (or a barcode repair) returned
// after startedAt, and that was then removed before this scan reached its page,
// keeps a fresh lastSyncedAt and is not delisted until the next full scan. That
// is a one-day delay, never a false delist. `delistedAt IS NULL` keeps the stamp
// idempotent: a variant already delisted in a prior scan keeps its original
// timestamp instead of being re-stamped.
//
// Resume-safe: on a scan resumed mid-way (cursor advanced after
// releaseToPending), `log.startedAt` stays the ORIGINAL enqueue time and every
// page upserted before the resume stamped lastSyncedAt AFTER startedAt, so the
// "older than startedAt" comparison still correctly treats those variants as
// present across the resume.
//
// Aggregates: Product.totalStock and the sale-price bounds count only listed
// variants (LISTED_VARIANT_WHERE in @pazarsync/catalog-sync), so each chunk of
// stamps is followed, in the same transaction, by a refresh of the stamped
// variants' products. Without it a product whose variant just left the feed
// would keep that variant's stock and price in its totals until its next write.
//
// Lease: the pass runs inside the final chunk, and the dispatcher only ticks
// lastTickAt between chunks, so a mass delist could outlast the watchdog's 90s
// stale-claim threshold and be re-run concurrently by a peer. The pass therefore
// heartbeats before its first chunk and after every chunk. The heartbeat is
// fenced on workerId: if the row was reaped, or re-claimed by another worker
// process, it throws LostLeaseError, which stops this pass and leaves the work
// to the new owner. The fence compares the per-process worker id, so a re-claim
// by this same process is not detected; the repeated absence predicate keeps
// such a concurrent pass idempotent.
async function runDelistPassIfComplete(
  log: SyncLog,
  workerId: string,
  doneReason: DelistDoneReason,
  observedTotalElements: number | null,
): Promise<void> {
  const skippedPages = parseSkippedPages(log.skippedPages);
  const decision = shouldRunDelistPass(skippedPages, doneReason, {
    progressCurrent: log.progressCurrent,
    observedTotalElements,
  });
  if (!decision.run) {
    syncLog.warn('products.delist-pass-skipped', {
      syncLogId: log.id,
      storeId: log.storeId,
      doneReason,
      reason: decision.reason,
      skippedPageCount: skippedPages.length,
    });
    return;
  }

  // Reset the stale-claim clock after the page fetch and upsert, and stop here
  // if the claim is already gone, before a single variant is stamped.
  await syncLogService.heartbeat(log.id, workerId);

  // Absent from this complete scan: no page of this run refreshed it, and no
  // earlier pass has stamped it yet.
  const absenceWhere = {
    storeId: log.storeId,
    lastSyncedAt: { lt: log.startedAt },
    delistedAt: null,
  } satisfies Prisma.ProductVariantWhereInput;

  const candidates = await prisma.productVariant.findMany({
    where: absenceWhere,
    select: { id: true, productId: true },
  });

  const delistedAt = new Date();
  let stampedCount = 0;
  for (let start = 0; start < candidates.length; start += DELIST_CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + DELIST_CHUNK_SIZE);
    const stamped = await prisma.$transaction(
      async (tx) => {
        // The absence predicate is repeated on the write so a variant that was
        // re-upserted between the read above and this chunk (e.g. by the
        // webhook's eager barcode repair) is not stamped by mistake.
        const result = await tx.productVariant.updateMany({
          where: { ...absenceWhere, id: { in: chunk.map((variant) => variant.id) } },
          data: { delistedAt },
        });
        const productIds = [...new Set(chunk.map((variant) => variant.productId))];
        await refreshProductAggregates(tx, log.storeId, productIds);
        return result.count;
      },
      { timeout: DELIST_CHUNK_TX_TIMEOUT_MS },
    );
    stampedCount += stamped;
    await syncLogService.heartbeat(log.id, workerId);
  }

  syncLog.info('products.delisted-by-absence', {
    syncLogId: log.id,
    storeId: log.storeId,
    count: stampedCount,
  });
}

// Terminal for a scan that ran past Trendyol's 10k page cap with no
// nextPageToken to continue: the tail beyond 10k is unreachable through this
// endpoint, so the run ends here. Surfaced in the logs so a catalog quietly
// capped at 10k items does not masquerade as a clean completion, and the delist
// pass is skipped — a truncated scan proves nothing about absence past the cap.
async function finishTruncatedPastCap(
  log: SyncLog,
  workerId: string,
  newProgress: number,
  observedTotalElements: number,
): Promise<ChunkResult> {
  syncLog.warn('products.catalog-truncated-10k', {
    syncLogId: log.id,
    storeId: log.storeId,
    progress: newProgress,
  });
  await runDelistPassIfComplete(log, workerId, 'truncated-past-cap', observedTotalElements);
  return { kind: 'done', finalCount: newProgress };
}

export async function processProductsChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
  workerId: string;
}): Promise<ChunkResult> {
  const { syncLog: log, workerId } = input;
  const rawCursor = parseProductsCursor(input.cursor);

  // Recovery path for token-stuck rows. If we receive a saved token
  // cursor and progress is still under the 10k cap (where token is
  // optional per Trendyol docs), substitute a page-based cursor at
  // the index that matches our current progress. Idempotent upsert
  // means re-fetching the page that produced progressCurrent doesn't
  // corrupt anything; in practice progressCurrent always lands on a
  // page boundary so no products are re-fetched.
  let cursor = rawCursor;
  if (
    rawCursor !== null &&
    rawCursor.kind === 'token' &&
    log.progressCurrent < APPROVED_PAGE_CAP_ITEMS
  ) {
    const fallbackPage = Math.floor(log.progressCurrent / PRODUCTS_PAGE_SIZE);
    syncLog.warn('chunk.cursor-token-fallback', {
      syncLogId: log.id,
      storeId: log.storeId,
      fromToken: rawCursor.token,
      toPage: fallbackPage,
      progressCurrent: log.progressCurrent,
    });
    cursor = { kind: 'page', n: fallbackPage };
  }

  syncLog.info('chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    progressCurrent: log.progressCurrent,
  });
  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields the FIRST page, then we return — the dispatcher loops
  // back through the queue with our cursor for the next page.
  const generator = fetchApprovedProducts({
    environment: store.environment,
    credentials,
    initialCursor: cursor,
  });
  const { value, done } = await generator.next();

  // Trendyol returned no more content (empty content[]) — sync is complete.
  // No page was observed here (the generator returned before yielding), so the
  // delist decision gets observedTotalElements = null and falls back to the
  // progressCurrent > 0 trust check.
  if (done === true || value === undefined) {
    await runDelistPassIfComplete(log, workerId, 'empty-page', null);
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
    await runDelistPassIfComplete(log, workerId, 'empty-batch', pageMeta.totalElements);
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  await upsertCatalogBatch(store, batch, log.id);

  const newProgress = log.progressCurrent + batch.length;

  // Two exit conditions, EITHER suffices:
  //   1. newProgress reached totalElements (Trendyol's claim of catalog size).
  //   2. We just processed the last documented page on a page-based cursor.
  //
  // (2) is load-bearing for catalogs where the worker's skip-bad-page
  // recovery dropped pages mid-stream — newProgress sits below
  // totalElements (the dropped page's items never landed) but we ARE
  // past the actual end of data. Without the totalPages check, the
  // chunk handler returns `kind: 'continue'`, the dispatcher requests
  // page totalPages+1, Trendyol responds 404 on out-of-range, the
  // skip-bad-page recovery advances the cursor +1, and the loop
  // never terminates (recovered seen at cursor=61+ on a 56-page
  // catalog where page 24 was earlier skipped — the user reports it
  // never reaches a terminal state, just churns forever).
  const justProcessedPage = cursor === null ? 0 : cursor.kind === 'page' ? cursor.n : null;
  const isLastDocumentedPage =
    justProcessedPage !== null &&
    pageMeta.totalPages > 0 &&
    justProcessedPage >= pageMeta.totalPages - 1;

  if (newProgress >= pageMeta.totalElements || isLastDocumentedPage) {
    await runDelistPassIfComplete(log, workerId, 'reached-end', pageMeta.totalElements);
    return { kind: 'done', finalCount: newProgress };
  }

  // Advance to the next page. Two cursor regimes:
  //   - token cursor: we are past Trendyol's 10k page cap (below it, the
  //     recovery path above rewrote any saved token to a page). Continue the
  //     TOKEN CHAIN — never fall back to page arithmetic, which would collapse
  //     the token to page 0, restart the walk at page 1, and abandon the >10k
  //     tail (the delist pass would then mass-stamp that unfetched tail). If
  //     Trendyol returned no further token, the tail is unreachable → truncation.
  //   - page cursor (or null = page 0): page-based arithmetic. The next cursor is
  //     cursor.n + 1; switch to a token only when the NEXT page would cross the
  //     10k cap AND Trendyol returned one. The cap guard is progress-based, so it
  //     stays correct even when a skip-bad-page recovery made cursor.n and real
  //     progress diverge.
  let nextCursor: ProductsCursor;
  if (cursor !== null && cursor.kind === 'token') {
    if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
      nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
    } else {
      return finishTruncatedPastCap(log, workerId, newProgress, pageMeta.totalElements);
    }
  } else {
    const nextPageN = (cursor === null ? 0 : cursor.n) + 1;
    const currentPageFromProgress = Math.floor(log.progressCurrent / PRODUCTS_PAGE_SIZE);
    const nextWouldCrossCap =
      (currentPageFromProgress + 1) * PRODUCTS_PAGE_SIZE >= APPROVED_PAGE_CAP_ITEMS;

    if (nextWouldCrossCap) {
      if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
        nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
      } else {
        return finishTruncatedPastCap(log, workerId, newProgress, pageMeta.totalElements);
      }
    } else {
      nextCursor = { kind: 'page', n: nextPageN };
    }
  }

  syncLog.info('chunk.complete', {
    syncLogId: log.id,
    pageBatchSize: batch.length,
    newProgress,
    totalElements: pageMeta.totalElements,
    nextCursor,
  });

  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: pageMeta.totalElements,
    stage: 'upserting',
  };
}

export const productsHandler: ModuleHandler = { processChunk: processProductsChunk };
