/**
 * Trendyol orders module handler — one chunk = one stream page.
 *
 * Order sync flow (Order Sync epic — design §5, BUG #9 migration):
 *   1. Decrypt store credentials
 *   2. Compute current chunk window (`lastModifiedStartDate`/`lastModifiedEndDate`)
 *      from the saved StreamOrdersCursor; fresh sync walks back from `endDate`
 *      to the cutoff (`computeOrdersCutoffMs` — store.createdAt by default,
 *      extended by SYNC_HISTORICAL_BACKFILL_DAYS in dev) in sliding 14-day chunks.
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
import type { SyncLog } from '@pazarsync/db';
import { fetchShipmentPackagesStream, STREAM_WINDOW_MAX_DAYS } from '@pazarsync/marketplace';
import { intakeOrder, upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import { parseOrdersCursor, syncLog, type OrdersStreamWindowCursor } from '@pazarsync/sync-core';

import { readSyncEnv } from '../lib/env';
import { decryptStoreCredentials } from '../lib/store-credentials';

import type { ChunkResult, ModuleHandler } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STREAM_CHUNK_DAYS = STREAM_WINDOW_MAX_DAYS; // 14, vendor enforced per call
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Inclusive lower-bound timestamp (ms) of the initial orders backfill window.
 *
 * Forward-only by default: with SYNC_HISTORICAL_BACKFILL_DAYS=0 (production)
 * the cutoff is `store.createdAt` — we never read orders from before the store
 * was connected, because their cost snapshots would be inconsistent (supplier
 * prices have since moved). Dev/stage may set a positive backfill to walk
 * further back for settlement testing; the result is still clamped so it can
 * never precede `store.createdAt`. See spec §5.3.
 *
 * NOTE: backfill=0 must collapse to `store.createdAt`, NOT `endDate`. The
 * literal `max(createdAt, endDate - 0)` returns `endDate` — an empty window
 * `[endDate, endDate]` — which would make a freshly connected store sync zero
 * chunks. The zero case is handled explicitly.
 */
export function computeOrdersCutoffMs(args: { storeCreatedAt: Date; endDate: number }): number {
  const { historicalBackfillDays } = readSyncEnv();
  const storeCreatedAtMs = args.storeCreatedAt.getTime();
  if (historicalBackfillDays === 0) {
    return storeCreatedAtMs;
  }
  const requestedStartMs = args.endDate - historicalBackfillDays * MS_PER_DAY;
  return Math.max(storeCreatedAtMs, requestedStartMs);
}

/**
 * Cutoff for a periodic (delta) sync: only the trailing SYNC_SAFETY_NET_HOURS,
 * clamped by `store.createdAt`. Webhook is the primary ingest path; the cron
 * tick is a safety net, so after the initial backfill it sweeps just the
 * recent hours a webhook delivery may have missed — not the whole history.
 */
export function computeDeltaCutoffMs(args: { storeCreatedAt: Date; endDate: number }): number {
  const { safetyNetHours } = readSyncEnv();
  const floorMs = args.endDate - safetyNetHours * MS_PER_HOUR;
  return Math.max(args.storeCreatedAt.getTime(), floorMs);
}

/**
 * Number of sliding 14-day stream chunks needed to cover `[cutoff, endDate]`.
 * Replaces the static STREAM_CHUNK_COUNT (90/14 = 7); now derived per store
 * from (`store.createdAt`, env). A fresh forward-only store yields 1 chunk.
 * `cutoffMsOverride` lets the delta path pass a tighter floor.
 */
export function computeStreamChunkCount(args: {
  storeCreatedAt: Date;
  endDate: number;
  cutoffMsOverride?: number;
}): number {
  const cutoffMs =
    args.cutoffMsOverride ??
    computeOrdersCutoffMs({ storeCreatedAt: args.storeCreatedAt, endDate: args.endDate });
  const spanDays = Math.ceil((args.endDate - cutoffMs) / MS_PER_DAY);
  if (spanDays <= 0) return 0;
  return Math.ceil(spanDays / STREAM_CHUNK_DAYS);
}

// ─── Chunk window helpers ────────────────────────────────────────────────────

interface ChunkBounds {
  startMs: number;
  endMs: number;
}

/**
 * Compute the `lastModifiedStartDate`/`lastModifiedEndDate` window for a
 * given chunk index. Chunks slide newest → oldest; the oldest chunk's start
 * is clamped to `computeOrdersCutoffMs` (store.createdAt by default) so the
 * window never precedes store connection.
 */
function computeChunkBounds(args: {
  storeCreatedAt: Date;
  endDate: number;
  chunkIndex: number;
  cutoffMsOverride?: number;
}): ChunkBounds {
  const { storeCreatedAt, endDate, chunkIndex } = args;
  const endMs = endDate - chunkIndex * STREAM_CHUNK_DAYS * MS_PER_DAY;
  const overallStartMs =
    args.cutoffMsOverride ?? computeOrdersCutoffMs({ storeCreatedAt, endDate });
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

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Initial vs delta window. The first sync for a store (no prior COMPLETED
  // ORDERS sync) walks the full backfill window from store.createdAt; every
  // periodic cron tick afterward sweeps only the trailing SYNC_SAFETY_NET_HOURS
  // — webhook is the primary ingest path, so re-scanning the whole history
  // hourly is wasteful. The in-flight sync (RUNNING) doesn't count; only a
  // prior COMPLETED ORDERS sync flips us to delta.
  const priorCompletedOrdersSync = await prisma.syncLog.findFirst({
    where: { storeId: log.storeId, syncType: 'ORDERS', status: 'COMPLETED' },
    select: { id: true },
  });
  const cutoffMsOverride =
    priorCompletedOrdersSync !== null
      ? computeDeltaCutoffMs({ storeCreatedAt: store.createdAt, endDate: cursor.endDate })
      : undefined;

  const bounds = computeChunkBounds({
    storeCreatedAt: store.createdAt,
    endDate: cursor.endDate,
    chunkIndex: cursor.chunkIndex,
    cutoffMsOverride,
  });
  const chunkCount = computeStreamChunkCount({
    storeCreatedAt: store.createdAt,
    endDate: cursor.endDate,
    cutoffMsOverride,
  });

  syncLog.info('orders.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    mode: cutoffMsOverride !== undefined ? 'delta' : 'initial',
    chunkBounds: { startMs: bounds.startMs, endMs: bounds.endMs },
    chunkCount,
    progressCurrent: log.progressCurrent,
  });

  // Empty window — store.createdAt is at/after endDate (clock skew or seed
  // data). chunkCount 0 means there is nothing to fetch; finish rather than
  // send the vendor an inverted [startMs > endMs] window.
  if (chunkCount === 0) {
    return advanceChunkOrFinish(log, cursor, log.progressCurrent, chunkCount);
  }

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
    return advanceChunkOrFinish(log, cursor, log.progressCurrent, chunkCount);
  }

  const { batch, nextCursor, hasMore } = value;

  // Upsert per-order (own transaction). Trendyol can emit duplicate orders
  // across cursor pages on lastModified shifts — upsert is idempotent.
  // Route per-order through the shared intake helper (own transaction each):
  // calculable → orders; cost-missing today → buffer; cost-missing past-day →
  // orders (null profit); variant_not_found → skip. Identical to the webhook.
  // Trendyol can emit duplicate orders across cursor pages — upsert + buffer
  // unique key are both idempotent.
  for (const order of batch) {
    try {
      const outcome = await intakeOrder({
        storeId: store.id,
        organizationId: store.organizationId,
        mapped: order,
      });
      // Exhaustive switch (mirrors the webhook route) — a new OrderIntakeOutcome
      // kind becomes a compile error here, not a silent fallthrough.
      switch (outcome.kind) {
        case 'skipped':
          syncLog.info('orders.skipped', {
            source: 'cron',
            reason: outcome.reason,
            syncLogId: log.id,
            storeId: log.storeId,
            platformOrderId: order.platformOrderId,
            barcode: outcome.barcode,
          });
          break;
        case 'buffered':
        case 'buffered_deduped':
          syncLog.info('buffer.entry-created', {
            source: 'cron',
            syncLogId: log.id,
            storeId: log.storeId,
            platformOrderId: order.platformOrderId,
            deduped: outcome.kind === 'buffered_deduped',
          });
          break;
        case 'persisted':
          // Steady-state happy path — no per-order log line.
          break;
        default: {
          const _exhaustive: never = outcome;
          throw new Error(`Unhandled intake outcome: ${JSON.stringify(_exhaustive)}`);
        }
      }
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
  return advanceChunkOrFinish(log, cursor, newProgress, chunkCount);
}

/**
 * Either move to the next chunk (chunkIndex+1, streamCursor reset) or
 * terminate the sync if all chunks have been processed.
 */
function advanceChunkOrFinish(
  log: SyncLog,
  cursor: OrdersStreamWindowCursor,
  progress: number,
  chunkCount: number,
): ChunkResult {
  if (cursor.chunkIndex >= chunkCount - 1) {
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

export { STREAM_CHUNK_DAYS, upsertOrderWithSnapshot };
