// Trendyol PRODUCTS_DELTA handler — one chunk = one inventory-and-price page.
//
// A lightweight hourly stock+price refresh. It walks the approved catalog's
// inventory-and-price feed (there is no date filter on this endpoint, so every
// tick is a full walk), diffs each page against the current DB state in memory,
// and writes back ONLY the variants whose quantity or sale/list price drifted.
//
// Deliberately does NOT touch lastSyncedAt — that column means "seen in the FULL
// catalog scan"; the daily PRODUCTS sync's delist diff (absence-from-feed)
// depends on it, so a partial inventory walk must never stamp it.
//
// Touches delistedAt in ONE direction only. A variant present in this
// inventory-and-price feed is, by definition, still listed. If its DB row
// carries a delistedAt stamp from an earlier full-scan absence pass, this
// handler CLEARS it (delistedAt: null) as part of the same update — even when
// quantity/prices are unchanged, because reappearance in the feed is itself the
// change. It NEVER SETS delistedAt: marking a variant absent stays owned by the
// full scan, which is the only pass that observes the whole catalog.
//
// The daily full PRODUCTS scan remains the source of metadata reconciliation
// (titles, images, brand/category, delist DETECTION). This handler only keeps
// stock and price fresh — and undoes a stale delist on reappearance — between
// those scans.
//
// Pagination reuses the products module's cursor model (ProductsCursor +
// parseProductsCursor): page-based below the 10k cap, nextPageToken past it,
// with the same past-cap-no-token termination (logged as
// products-delta.catalog-truncated-10k). PRODUCTS_PAGE_SIZE /
// APPROVED_PAGE_CAP_ITEMS import from the marketplace package — single source
// of truth so the token->page fallback math stays consistent with the fetcher.

import { computeProductAggregates } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';
import {
  APPROVED_PAGE_CAP_ITEMS,
  decryptStoreCredentials,
  fetchInventoryAndPrice,
  PRODUCTS_PAGE_SIZE,
} from '@pazarsync/marketplace';
import { parseProductsCursor, syncLog, type ProductsCursor } from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';
import { computeVariantChanges, type ExistingVariantState } from './products-delta-diff';

// Terminal for a delta walk that ran past Trendyol's 10k page cap with no
// nextPageToken to continue: the tail beyond 10k is unreachable through this
// endpoint, so the run ends here. Surfaced so a catalog quietly capped at 10k
// items is observable rather than masquerading as a clean completion. Unlike the
// full products handler, the delta handler owns no delist pass, so this only
// warns and returns done.
function finishTruncatedPastCap(log: SyncLog, storeId: string, newProgress: number): ChunkResult {
  syncLog.warn('products-delta.catalog-truncated-10k', {
    syncLogId: log.id,
    storeId,
    progress: newProgress,
  });
  return { kind: 'done', finalCount: newProgress };
}

export async function processProductsDeltaChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const cursor = parseProductsCursor(input.cursor);

  syncLog.info('products-delta.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    progressCurrent: log.progressCurrent,
  });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields the FIRST page, then we return — the dispatcher loops
  // back through the queue with our cursor for the next page.
  const generator = fetchInventoryAndPrice({
    environment: store.environment,
    credentials,
    initialCursor: cursor,
  });
  const { value, done } = await generator.next();

  if (done === true || value === undefined) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, contentCount, pageMeta } = value;

  if (contentCount === 0) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  // Load the current DB state for every variant on this page in one query.
  // quantity + sale/list price participate in the drift diff; delistedAt lets
  // the diff force an update that clears a stale delist on reappearance; id +
  // productId are needed to write back and to re-aggregate the affected products.
  const platformVariantIds = batch.map((variant) => variant.platformVariantId);
  const existingRows = await prisma.productVariant.findMany({
    where: { storeId: store.id, platformVariantId: { in: platformVariantIds } },
    select: {
      id: true,
      productId: true,
      platformVariantId: true,
      quantity: true,
      salePrice: true,
      listPrice: true,
      delistedAt: true,
    },
  });

  const existingByVariantId = new Map<bigint, ExistingVariantState>();
  for (const row of existingRows) {
    existingByVariantId.set(row.platformVariantId, {
      id: row.id,
      productId: row.productId,
      quantity: row.quantity,
      salePrice: row.salePrice.toString(),
      listPrice: row.listPrice.toString(),
      delistedAt: row.delistedAt,
    });
  }

  const changes = computeVariantChanges(batch, existingByVariantId);

  // One info log per page for unknown variants — never per-row spam. A variant
  // the delta feed knows but our catalog does not means the daily full scan has
  // not caught up; it lands in the catalog on the next PRODUCTS run, so skip.
  if (changes.unknownCount > 0) {
    syncLog.info('products-delta.unknown-variants', {
      syncLogId: log.id,
      storeId: store.id,
      count: changes.unknownCount,
    });
  }

  if (changes.updates.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const update of changes.updates) {
        await tx.productVariant.update({
          where: { id: update.id },
          // Write the drifted stock/price fields. NEVER lastSyncedAt (full-scan
          // marker). delistedAt is cleared to null ONLY for a row that
          // reappeared in the feed after a prior delist (clearDelistedAt); it is
          // never SET here — absence detection stays owned by the full scan.
          data: {
            quantity: update.quantity,
            salePrice: update.salePrice,
            listPrice: update.listPrice,
            ...(update.clearDelistedAt ? { delistedAt: null } : {}),
          },
        });
      }

      // Recompute the denormalized Product aggregates for the DISTINCT products
      // whose variants changed. totalStock / min-max sale price span ALL of a
      // product's variants, so re-read the full variant set (inside the same
      // transaction, after the writes above) rather than the page subset.
      for (const productId of changes.affectedProductIds) {
        const variants = await tx.productVariant.findMany({
          where: { productId },
          select: { quantity: true, salePrice: true },
        });
        const { totalStock, minSalePrice, maxSalePrice } = computeProductAggregates(
          variants.map((variant) => ({
            quantity: variant.quantity,
            salePrice: variant.salePrice.toString(),
          })),
        );
        await tx.product.update({
          where: { id: productId },
          data: { totalStock, minSalePrice, maxSalePrice },
        });
      }
    });
  }

  const newProgress = log.progressCurrent + contentCount;

  // Two exit conditions, EITHER suffices (identical to the full products
  // handler): totalElements reached, OR we just processed the last documented
  // page. The last-page check keeps a page-based walk from running off the end
  // when a page's content count nudges progress just under totalElements.
  const justProcessedPage = cursor === null ? 0 : cursor.kind === 'page' ? cursor.n : null;
  const isLastDocumentedPage =
    justProcessedPage !== null &&
    pageMeta.totalPages > 0 &&
    justProcessedPage >= pageMeta.totalPages - 1;

  if (newProgress >= pageMeta.totalElements || isLastDocumentedPage) {
    return { kind: 'done', finalCount: newProgress };
  }

  // Advance to the next page. Mirrors the full products handler exactly:
  //   - token cursor: continue the TOKEN CHAIN past the 10k cap. Never fall back
  //     to page arithmetic, which would collapse the token to page 0 and restart
  //     the walk at page 1, re-diffing already-seen pages and abandoning the >10k
  //     tail. No further token → the tail is unreachable → truncation done.
  //   - page cursor (or null = page 0): next cursor is cursor.n + 1; switch to a
  //     token only when the NEXT page would cross the 10k cap AND Trendyol
  //     returned one. The cap guard is progress-based so it stays correct even if
  //     cursor.n and real progress diverge.
  let nextCursor: ProductsCursor;
  if (cursor !== null && cursor.kind === 'token') {
    if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
      nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
    } else {
      return finishTruncatedPastCap(log, store.id, newProgress);
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
        return finishTruncatedPastCap(log, store.id, newProgress);
      }
    } else {
      nextCursor = { kind: 'page', n: nextPageN };
    }
  }

  syncLog.info('products-delta.chunk.complete', {
    syncLogId: log.id,
    pageContentCount: contentCount,
    changedCount: changes.updates.length,
    unknownCount: changes.unknownCount,
    newProgress,
    totalElements: pageMeta.totalElements,
    nextCursor,
  });

  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: pageMeta.totalElements,
    stage: 'diffing',
  };
}

export const productsDeltaHandler: ModuleHandler = { processChunk: processProductsDeltaChunk };
