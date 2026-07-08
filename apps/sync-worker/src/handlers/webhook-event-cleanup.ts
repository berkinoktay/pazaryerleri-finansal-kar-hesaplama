/**
 * Webhook-event retention cleanup tick.
 *
 * `webhook_events` is an idempotency + raw-audit log that only ever grows — the
 * webhook receiver INSERTs one row per delivery and nothing deletes them. This
 * tick prunes rows older than the retention window so the table stays bounded.
 *
 * Retention window is WEBHOOK_EVENT_RETENTION_DAYS (optional; DEFAULT_RETENTION_DAYS
 * when unset/invalid). Deletion is BATCHED — a single unbounded DELETE would take a
 * long table-wide lock and fight the receiver's INSERTs; instead each statement
 * removes at most BATCH_SIZE rows and the loop stops once a batch comes back short.
 *
 * Idempotent and crash-safe: the caller (index.ts) wraps this in a catch so a DB
 * hiccup never crashes the worker, and a partially-completed run simply resumes on
 * the next tick.
 */

import { prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';

const DEFAULT_RETENTION_DAYS = 90;
const BATCH_SIZE = 10_000;
const DAY_MS = 24 * 60 * 60_000;

// Fire-once guard: this tick runs daily, so warning on every read of a bad value
// would slowly accrue noise. Modelled on webhook-reconcile's baseUrlSkipWarned —
// warn once when the value is invalid, reset when it becomes valid/absent again.
let invalidRetentionWarned = false;

/**
 * Resolve the retention window from WEBHOOK_EVENT_RETENTION_DAYS. Unset/empty is
 * the normal case → default silently. A present-but-invalid value (non-integer or
 * <= 0) falls back to the default and warns once.
 */
function resolveRetentionDays(): number {
  const raw = process.env['WEBHOOK_EVENT_RETENTION_DAYS'];
  if (raw === undefined || raw === '') {
    invalidRetentionWarned = false;
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    if (!invalidRetentionWarned) {
      invalidRetentionWarned = true;
      syncLog.warn('webhook.event-cleanup-invalid-retention', {
        value: raw,
        fallbackDays: DEFAULT_RETENTION_DAYS,
        hint: 'WEBHOOK_EVENT_RETENTION_DAYS must be a positive integer number of days; using the default.',
      });
    }
    return DEFAULT_RETENTION_DAYS;
  }
  invalidRetentionWarned = false;
  return parsed;
}

export async function processWebhookEventCleanup(): Promise<void> {
  const days = resolveRetentionDays();
  const cutoff = new Date(Date.now() - days * DAY_MS);

  let total = 0;
  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM webhook_events
      WHERE id IN (
        SELECT id FROM webhook_events
        WHERE received_at < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )
    `;
    total += deleted;
    if (deleted < BATCH_SIZE) break;
  }

  // Stay silent on a no-op run — the daily cadence would otherwise log a line
  // every day forever. Only announce when rows were actually pruned.
  if (total > 0) {
    syncLog.info('webhook.event-cleanup', { deleted: total, retentionDays: days });
  }
}
