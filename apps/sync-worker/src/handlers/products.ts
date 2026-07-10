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

import { upsertCatalogBatch } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';
import {
  APPROVED_PAGE_CAP_ITEMS,
  decryptStoreCredentials,
  fetchApprovedProducts,
  PRODUCTS_PAGE_SIZE,
} from '@pazarsync/marketplace';
import { parseProductsCursor, syncLog, type ProductsCursor } from '@pazarsync/sync-core';

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

export async function processProductsChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
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
  if (done === true || value === undefined) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
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
    return { kind: 'done', finalCount: newProgress };
  }

  // Advance to the next page. Per Trendyol's documented contract,
  // page-based pagination is the default below the 10k cap and
  // nextPageToken is reserved for past-cap walks. Compute next page
  // index from the cursor we just consumed; switch to token only when
  // the next page would cross the 10k boundary AND Trendyol gave us
  // a token to continue with.
  const currentPageN = cursor === null ? 0 : cursor.kind === 'page' ? cursor.n : 0;
  const nextPageN = currentPageN + 1;
  const nextWouldCrossCap = nextPageN * PRODUCTS_PAGE_SIZE >= APPROVED_PAGE_CAP_ITEMS;

  let nextCursor: ProductsCursor;
  if (nextWouldCrossCap) {
    if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
      nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
    } else {
      // Past the 10k cap and no token — Trendyol gave us no way
      // forward. Treat as done; the catalog beyond 10k is unreachable
      // through this endpoint without a token. The truncation used to
      // return silently and looked identical to a clean completion; it is
      // now observable in the logs, so a catalog quietly capped at 10k
      // items surfaces instead of masquerading as a finished sync.
      syncLog.warn('products.catalog-truncated-10k', {
        syncLogId: log.id,
        storeId: log.storeId,
        progress: newProgress,
      });
      return { kind: 'done', finalCount: newProgress };
    }
  } else {
    nextCursor = { kind: 'page', n: nextPageN };
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
