import type { SyncLog, SyncType } from '@pazarsync/db';
import { syncLogService } from '@pazarsync/sync-core';

import { MANUAL_SYNC_COOLDOWN_SECONDS } from '../config/sync-cooldowns';
import { RateLimitedError } from '../lib/errors';

const MS_PER_SECOND = 1000;

/**
 * SyncLog statuses that occupy the partial active-slot unique index
 * (`sync_logs_active_slot_uniq`). While a row in one of these states
 * exists, `acquireSlot` throws 409 SyncInProgressError — so the cooldown
 * check deliberately does NOT preempt it with a 429. A currently-running
 * sync keeps its existing conflict shape (with `meta.existingSyncLogId`
 * so the UI can jump to the live run) instead of being masked as "cooling".
 */
const ACTIVE_STATUSES: ReadonlySet<SyncLog['status']> = new Set([
  'PENDING',
  'RUNNING',
  'FAILED_RETRYABLE',
]);

/**
 * Enqueue a user-initiated (MANUAL) sync, enforcing the per-(store,
 * syncType) cooldown BEFORE acquiring the slot:
 *
 *   1. Look up the most recent MANUAL sync for this (store, syncType),
 *      any status.
 *   2. If it is terminal (COMPLETED / FAILED) and its `startedAt` is still
 *      inside the cooldown window, reject with 429 RATE_LIMITED carrying a
 *      `Retry-After` of the remaining whole seconds.
 *   3. Otherwise fall through to `acquireSlot`, which inserts a PENDING
 *      MANUAL row — or throws 409 SyncInProgressError when an active slot
 *      already exists. An active (running / pending / retrying) MANUAL row
 *      is intentionally skipped by step 2 so a running sync keeps its 409
 *      rather than being reported as a cooldown 429.
 */
export async function triggerManualSync(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
): Promise<SyncLog> {
  const cooldownSeconds = MANUAL_SYNC_COOLDOWN_SECONDS[syncType];
  const last = await syncLogService.getMostRecentManualSync(organizationId, storeId, syncType);

  if (last !== null && !ACTIVE_STATUSES.has(last.status)) {
    const elapsedSeconds = (Date.now() - last.startedAt.getTime()) / MS_PER_SECOND;
    const remainingSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
    if (remainingSeconds > 0) {
      throw new RateLimitedError(remainingSeconds, 'Manual sync triggered before cooldown elapsed');
    }
  }

  return syncLogService.acquireSlot(organizationId, storeId, syncType, 'MANUAL');
}
