/**
 * Trendyol orders module handler — one chunk = one page of orders.
 *
 * Order sync flow (Order Sync epic — design §5):
 *   1. Decrypt store credentials
 *   2. Compute window (initial backfill: 90 gün geriye; delta sync PR-D'de)
 *   3. fetchShipmentPackages → MappedOrder[] (PR-A KDV-split mapper)
 *   4. For each MappedOrder:
 *      - upsertOrderWithSnapshot (from `@pazarsync/order-sync`) →
 *        Order upsert + OrderItem write-once + cost snapshot +
 *        applyEstimateOnOrderCreate plug-in, single transaction
 *   5. Advance cursor (page+1) within same window; signal done at end
 *
 * The persistence logic itself lives in `@pazarsync/order-sync` so the webhook
 * receiver (apps/api PR-C3b) can call the same write path. This handler now
 * owns only the *fetch* concerns: credential decrypt, window/cursor advance,
 * per-page resilience.
 */

import { prisma } from '@pazarsync/db';
import type { SyncLog, Store } from '@pazarsync/db';
import {
  fetchShipmentPackages,
  isTrendyolCredentials,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import { upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import {
  decryptCredentials,
  parseOrdersCursor,
  syncLog,
  type OrdersCursor,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Initial backfill window — V1 hardcoded 90 gün (design §4.1). */
const INITIAL_BACKFILL_DAYS = 90;
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

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Process one page of Trendyol orders.
 *
 * Cursor semantics (OrdersCursor `kind: 'page-window'`):
 *   - First invocation (cursor null): set window = [now − 90d, now], page = 0
 *   - Subsequent: same window, advance page
 *   - Window exhausted (totalElements reached): return done
 *
 * Trendyol fetch + map per PR-A's `fetchShipmentPackages` + `mapTrendyolShipmentPackage`.
 *
 * One chunk = one Trendyol page (≤200 orders). Dispatcher reschedules with
 * advanced cursor; SyncLog progress tracks running count.
 */
export async function processOrdersChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const parsedCursor = parseOrdersCursor(input.cursor);

  // Fresh sync → initial backfill window. Resumed sync → use saved window.
  const now = Date.now();
  const cursor: OrdersCursor = parsedCursor ?? {
    kind: 'page-window',
    startDate: now - INITIAL_BACKFILL_DAYS * MS_PER_DAY,
    endDate: now,
    n: 0,
  };

  syncLog.info('orders.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    progressCurrent: log.progressCurrent,
  });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields ONE page, then we return — dispatcher loops with our cursor.
  const generator = fetchShipmentPackages({
    environment: store.environment,
    credentials,
    startDate: cursor.startDate,
    endDate: cursor.endDate,
    initialPage: cursor.n,
  });
  const { value, done } = await generator.next();

  if (done === true || value === undefined) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'generator-exhausted',
    });
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'empty-page',
    });
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  // Upsert per-order (own transaction). Trendyol bazen aynı page'de duplicate
  // order gönderebilir — upsert idempotent, sorun değil.
  for (const order of batch) {
    try {
      await upsertOrderWithSnapshot(store.id, store.organizationId, order);
    } catch (err) {
      // Per-order resilience: tek malformed order tüm chunk'ı patlatmasın.
      // Edge case (PR-E'de daha kapsamlı recovery): variant constraint vs.
      syncLog.error('orders.upsert.failed', {
        syncLogId: log.id,
        storeId: log.storeId,
        platformOrderId: order.platformOrderId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const newProgress = log.progressCurrent + batch.length;

  // Terminal: tüm window işlendi.
  if (newProgress >= pageMeta.totalElements) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'window-exhausted',
      finalCount: newProgress,
    });
    return { kind: 'done', finalCount: newProgress };
  }

  const nextCursor: OrdersCursor = {
    kind: 'page-window',
    startDate: cursor.startDate,
    endDate: cursor.endDate,
    n: cursor.n + 1,
  };

  syncLog.info('orders.chunk.complete', {
    syncLogId: log.id,
    storeId: log.storeId,
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

export const ordersHandler: ModuleHandler = { processChunk: processOrdersChunk };

export { INITIAL_BACKFILL_DAYS, upsertOrderWithSnapshot };
