/**
 * Trendyol orders module handler — one chunk = one stream page.
 *
 * Order sync flow (Order Sync epic — design §5, BUG #9 migration):
 *   1. Decrypt store credentials
 *   2. Compute current chunk window (`lastModifiedStartDate`/`lastModifiedEndDate`)
 *      from the saved StreamOrdersCursor; fresh sync covers ~90 gün backfill
 *      split into `STREAM_CHUNK_COUNT` sliding 14-day chunks.
 *   3. fetchShipmentPackagesStream → one StreamPageResult per dispatcher tick
 *      (PR-A KDV-split mapper still applies)
 *   4. For each MappedOrder:
 *      - upsertOrderWithSnapshot (from `@pazarsync/order-sync`) →
 *        Order upsert + OrderItem write-once + cost snapshot +
 *        applyEstimateOnOrderCreate plug-in, single transaction
 *   5. Advance cursor:
 *      - within chunk (hasMore + nextCursor) → save streamCursor
 *      - end of chunk → chunkIndex+1, streamCursor=null
 *      - end of last chunk → done
 *
 * BUG #9 (2026-05-22) migrated from `getShipmentPackages` (page-based, 1
 * month max planned vendor restriction) to `getShipmentPackagesStream`
 * (cursor-based, 3 month max, optimised for full scans / cron — see
 * docs/plans/2026-05-22-pr7-bug9-endpoint-migration.md). Legacy
 * `page-window` cursors on existing SyncLog rows are treated as a
 * fresh-start signal so no manual reset is needed.
 *
 * The persistence logic itself lives in `@pazarsync/order-sync` so the webhook
 * receiver (apps/api PR-C3b) can call the same write path. This handler now
 * owns only the *fetch* concerns: credential decrypt, chunk/cursor advance,
 * per-page resilience.
 */

import { prisma } from '@pazarsync/db';
import type { SyncLog, Store } from '@pazarsync/db';
import {
  fetchShipmentPackagesStream,
  isTrendyolCredentials,
  STREAM_WINDOW_MAX_DAYS,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import { upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import {
  decryptCredentials,
  parseOrdersCursor,
  syncLog,
  type OrdersStreamWindowCursor,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Initial backfill window — V1 hardcoded 90 gün.
 *
 * Trendyol's stream endpoint (`getShipmentPackagesStream`) exposes the last
 * 3 months of orders (`siparis-paketlerini-akis-ile-cekme-getshipmentpackagesstream.md`
 * line 22-25). 90d covers Trendyol's full cycle T+30 payment timing plus
 * buffer — the 30d backfill of BUG #7 was a workaround for the legacy page
 * endpoint's 1-month cap and is reverted now that the stream endpoint is in
 * use. See window math comment in `apps/sync-worker/src/handlers/settlements/cron.ts`
 * for the sound rule (Settlement W ≥ Order backfill + cycle buffer).
 */
const INITIAL_BACKFILL_DAYS = 90;
const STREAM_CHUNK_DAYS = STREAM_WINDOW_MAX_DAYS; // 14, vendor enforced per call
const STREAM_CHUNK_COUNT = Math.ceil(INITIAL_BACKFILL_DAYS / STREAM_CHUNK_DAYS); // 7
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Credentials decryption (products.ts mirror) ─────────────────────────────

function decryptStoreCredentials(store: Store): TrendyolCredentials {
  // Prisma's Json column type is `JsonValue`, not `string`; the actual
  // runtime value here is the AES-256-GCM ciphertext base64 blob.
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new Error('Invalid Trendyol credentials shape on store');
  }
  return decrypted;
}

// ─── Chunk window helpers ────────────────────────────────────────────────────

interface ChunkBounds {
  startMs: number;
  endMs: number;
}

/**
 * Compute the `lastModifiedStartDate`/`lastModifiedEndDate` window for a
 * given chunk index. Chunks slide newest → oldest; the oldest chunk's
 * start is clamped to `endDate − INITIAL_BACKFILL_DAYS` so non-divisible
 * backfills still respect the configured total.
 */
function computeChunkBounds(endDate: number, chunkIndex: number): ChunkBounds {
  const endMs = endDate - chunkIndex * STREAM_CHUNK_DAYS * MS_PER_DAY;
  const overallStartMs = endDate - INITIAL_BACKFILL_DAYS * MS_PER_DAY;
  const candidateStart = endMs - STREAM_CHUNK_DAYS * MS_PER_DAY;
  const startMs = Math.max(candidateStart, overallStartMs);
  return { startMs, endMs };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Process one page of Trendyol orders via the stream endpoint.
 *
 * Cursor semantics (OrdersStreamWindowCursor `kind: 'stream-window'`):
 *   - First invocation (cursor null OR legacy `page-window`):
 *       set { endDate: now, chunkIndex: 0, streamCursor: null }
 *   - Within a chunk (hasMore + nextCursor): advance streamCursor
 *   - End of chunk (!hasMore): chunkIndex+1, streamCursor=null
 *   - End of last chunk: return done
 *
 * One chunk = one stream page (≤ORDERS_PAGE_SIZE orders). Dispatcher
 * reschedules with the advanced cursor; SyncLog progress tracks running
 * count.
 */
export async function processOrdersChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const parsed = parseOrdersCursor(input.cursor);

  // Fresh sync → initial backfill window. Resumed (stream-window) → continue.
  // Legacy `page-window` cursor → treat as fresh start (BUG #9 migration:
  // re-run from the newest chunk under the new endpoint). The log line
  // records this transition for telemetry but no manual reset is needed.
  let cursor: OrdersStreamWindowCursor;
  if (parsed === null) {
    cursor = { kind: 'stream-window', endDate: Date.now(), chunkIndex: 0, streamCursor: null };
  } else if (parsed.kind === 'stream-window') {
    cursor = parsed;
  } else {
    syncLog.info('orders.chunk.legacy-cursor-reset', {
      syncLogId: log.id,
      storeId: log.storeId,
      legacyKind: parsed.kind,
    });
    cursor = { kind: 'stream-window', endDate: Date.now(), chunkIndex: 0, streamCursor: null };
  }

  const bounds = computeChunkBounds(cursor.endDate, cursor.chunkIndex);

  syncLog.info('orders.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    chunkBounds: { startMs: bounds.startMs, endMs: bounds.endMs },
    progressCurrent: log.progressCurrent,
  });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields ONE stream page, then we return — dispatcher loops
  // with our advanced cursor (re-creates the generator next tick).
  const generator = fetchShipmentPackagesStream({
    environment: store.environment,
    credentials,
    lastModifiedStartDate: bounds.startMs,
    lastModifiedEndDate: bounds.endMs,
    cursor: cursor.streamCursor ?? undefined,
  });
  const { value, done } = await generator.next();

  if (done === true || value === undefined) {
    // Empty stream for this chunk — advance to the next chunk or finish.
    return advanceChunkOrFinish(log, cursor, log.progressCurrent);
  }

  const { batch, nextCursor, hasMore } = value;

  // Upsert per-order (own transaction). Trendyol can emit duplicate orders
  // across cursor pages on lastModified shifts — upsert is idempotent.
  for (const order of batch) {
    try {
      await upsertOrderWithSnapshot(store.id, store.organizationId, order);
    } catch (err) {
      // Per-order resilience: one malformed order doesn't terminate the chunk.
      syncLog.error('orders.upsert.failed', {
        syncLogId: log.id,
        storeId: log.storeId,
        platformOrderId: order.platformOrderId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const newProgress = log.progressCurrent + batch.length;

  // More pages in this chunk → advance streamCursor (same chunkIndex).
  if (hasMore === true && nextCursor !== null) {
    const nextCursorState: OrdersStreamWindowCursor = {
      kind: 'stream-window',
      endDate: cursor.endDate,
      chunkIndex: cursor.chunkIndex,
      streamCursor: nextCursor,
    };
    syncLog.info('orders.chunk.complete', {
      syncLogId: log.id,
      storeId: log.storeId,
      pageBatchSize: batch.length,
      newProgress,
      hasMore,
      nextCursorState,
    });
    return {
      kind: 'continue',
      cursor: nextCursorState,
      progress: newProgress,
      total: null, // stream endpoint omits totalElements
      stage: 'streaming',
    };
  }

  // Chunk exhausted — advance to next chunk or finish.
  return advanceChunkOrFinish(log, cursor, newProgress);
}

/**
 * Either move to the next chunk (chunkIndex+1, streamCursor reset) or
 * terminate the sync if all chunks have been processed.
 */
function advanceChunkOrFinish(
  log: SyncLog,
  cursor: OrdersStreamWindowCursor,
  progress: number,
): ChunkResult {
  if (cursor.chunkIndex >= STREAM_CHUNK_COUNT - 1) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'all-chunks-exhausted',
      finalCount: progress,
    });
    return { kind: 'done', finalCount: progress };
  }

  const nextCursorState: OrdersStreamWindowCursor = {
    kind: 'stream-window',
    endDate: cursor.endDate,
    chunkIndex: cursor.chunkIndex + 1,
    streamCursor: null,
  };
  syncLog.info('orders.chunk.next-chunk', {
    syncLogId: log.id,
    storeId: log.storeId,
    fromChunkIndex: cursor.chunkIndex,
    toChunkIndex: nextCursorState.chunkIndex,
    progress,
  });
  return {
    kind: 'continue',
    cursor: nextCursorState,
    progress,
    total: null,
    stage: 'streaming',
  };
}

export const ordersHandler: ModuleHandler = { processChunk: processOrdersChunk };

export { INITIAL_BACKFILL_DAYS, STREAM_CHUNK_COUNT, STREAM_CHUNK_DAYS, upsertOrderWithSnapshot };
