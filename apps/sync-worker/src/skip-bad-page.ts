// Skip-bad-page recovery for the sync worker. Trendyol has been
// observed to return deterministic 5xx on specific page offsets for
// individual seller catalogs (a known upstream serializer/pagination
// bug — see docs/integrations/trendyol/7-trendyol-marketplace-
// entegrasyonu/urun-entegrasyonlari-v2.md). When MAX_ATTEMPTS is hit
// on `MARKETPLACE_UNREACHABLE`, the worker advances past the bad page
// instead of terminally failing the whole sync — partial-but-
// completed beats fully-stuck.
//
// Boundaries:
//   - Caller decides WHEN to invoke (handleRunError, only for
//     MARKETPLACE_UNREACHABLE at the MAX_ATTEMPTS ceiling).
//   - This module decides WHAT the next cursor is and assembles the
//     SkippedPageEntry from whatever diagnostic the marketplace
//     layer attached to the error.
//   - sync-core's `recordSkippedPageAndContinue` does the atomic DB
//     state transition.

import { prisma } from '@pazarsync/db';
import {
  parseProductsCursor,
  syncLog,
  syncLogService,
  type ProductsCursor,
  type SkippedPageEntry,
} from '@pazarsync/sync-core';

const TRENDYOL_PRODUCTS_PAGE_SIZE = 100;
const TRENDYOL_APPROVED_PAGE_CAP_ITEMS = 10_000;

/**
 * Try to advance past a bad page after MAX_ATTEMPTS exhaustion. Returns
 * true if the row was successfully advanced (the worker should NOT call
 * `fail`); false if no recovery is possible (the worker should fall
 * through to `fail` so the row terminates).
 *
 * No recovery cases:
 *   - Cursor is malformed (CORRUPT_CHECKPOINT path applies, not this).
 *   - Next page would cross the 10k Trendyol cap and we have no
 *     nextPageToken to substitute. The catalog tail past 10k is
 *     unreachable without a token, so terminating is correct.
 */
export async function advanceCursorPastBadPage(syncLogId: string, err: unknown): Promise<boolean> {
  const row = await prisma.syncLog.findUnique({
    where: { id: syncLogId },
    select: { pageCursor: true, progressCurrent: true },
  });
  if (row === null) return false;

  let cursor: ProductsCursor | null;
  try {
    cursor = parseProductsCursor(row.pageCursor);
  } catch (parseErr) {
    syncLog.error('skip.cursor.parse-failed', {
      syncLogId,
      errorMessage: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    return false;
  }

  // We can only skip-and-advance over page-based cursors. A token-only
  // cursor means we've crossed the 10k cap; without a fallback token
  // we can't compute a "next page" safely. (In practice the products
  // handler converts token cursors back to page-based when below the
  // cap, so this branch only fires in legitimate post-cap territory.)
  const currentPageN = cursor === null ? 0 : cursor.kind === 'page' ? cursor.n : null;
  if (currentPageN === null) {
    syncLog.warn('skip.token-cursor.no-recovery', { syncLogId, cursor });
    return false;
  }

  const nextPageN = currentPageN + 1;
  const nextWouldCrossCap =
    nextPageN * TRENDYOL_PRODUCTS_PAGE_SIZE >= TRENDYOL_APPROVED_PAGE_CAP_ITEMS;
  if (nextWouldCrossCap) {
    // We don't have access to a nextPageToken at the worker layer (it
    // lives on the in-flight page response, which is gone). Falling
    // through to terminal FAIL is the correct behavior.
    syncLog.warn('skip.cap-reached.no-recovery', { syncLogId, nextPageN });
    return false;
  }

  const nextCursor: ProductsCursor = { kind: 'page', n: nextPageN };
  const newProgress = nextPageN * TRENDYOL_PRODUCTS_PAGE_SIZE;

  const skipEntry: SkippedPageEntry = {
    page: currentPageN,
    attemptedAt: new Date().toISOString(),
    errorCode: 'MARKETPLACE_UNREACHABLE',
    httpStatus: extractHttpStatus(err),
    xRequestId: extractXRequestId(err),
    responseBodySnippet: extractBodySnippet(err),
  };

  await syncLogService.recordSkippedPageAndContinue(syncLogId, skipEntry, nextCursor, newProgress);
  return true;
}

interface UnreachableMeta {
  httpStatus?: number;
  xRequestId?: string;
  responseBodySnippet?: string;
}

function readMeta(err: unknown): UnreachableMeta | null {
  if (typeof err !== 'object' || err === null) return null;
  if (!('meta' in err)) return null;
  const meta = (err as { meta: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return null;
  return meta as UnreachableMeta;
}

function extractHttpStatus(err: unknown): number {
  return readMeta(err)?.httpStatus ?? 0;
}

function extractXRequestId(err: unknown): string | undefined {
  return readMeta(err)?.xRequestId;
}

function extractBodySnippet(err: unknown): string | undefined {
  return readMeta(err)?.responseBodySnippet;
}
