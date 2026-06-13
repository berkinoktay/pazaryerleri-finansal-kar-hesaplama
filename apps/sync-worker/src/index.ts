// Sync worker entry point.
//
// Long-running process that polls `sync_logs` for claimable rows
// (PENDING, or FAILED_RETRYABLE whose backoff has elapsed), then drives
// each claim through chunks until the run terminates or the worker is
// shutting down.
//
// Lifecycle:
//   1. Install SIGTERM/SIGINT handlers — both flip `shuttingDown` so the
//      claim loop exits between chunks (never mid-chunk; chunks are
//      atomic w.r.t. their own DB writes).
//   2. Start a watchdog timer that sweeps stale RUNNING claims back to
//      PENDING every WATCHDOG_INTERVAL_MS so a crashed peer's work is
//      reclaimable.
//   3. Poll-and-claim loop with exponential backoff when no row is
//      claimable. On a successful claim, hand off to runSyncToCompletion;
//      on a thrown error, classify it (permanent → FAIL, transient →
//      markRetryable with exponential backoff up to MAX_ATTEMPTS).
//
// Error classification rationale:
//   - MARKETPLACE_AUTH_FAILED / MARKETPLACE_ACCESS_DENIED → user must
//     fix credentials/whitelist; retrying does not help. Mark FAILED so
//     the SyncCenter UI shows a terminal error and the user takes action.
//   - All other errors → transient (network blip, marketplace 5xx,
//     transient DB failure, malformed checkpoint that produced a
//     ZodError → coerced to INTERNAL_ERROR by errorCodeOf). markRetryable
//     bumps the row to FAILED_RETRYABLE with `nextAttemptAt` set by the
//     backoff schedule in syncLogService.markRetryable. Once attemptCount
//     reaches MAX_ATTEMPTS we give up and mark the row terminally FAILED.

import { randomBytes } from 'node:crypto';

import { syncLog, tryClaimNext } from '@pazarsync/sync-core';

import { errorCodeOf } from './error-code';
import { processBufferPromote, processPastDayBufferFlush } from './handlers/buffer-promote';
import { processVariantResolution } from './handlers/variant-resolution';
import { processWebhookReconcile } from './handlers/webhook-reconcile';
import { runSyncToCompletion } from './loop';
import { REGISTRY } from './registry';
import { errorMessageOf, handleRunError } from './run-error';
import { sweepStaleClaims } from './watchdog';

const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`;
const POLL_BACKOFF_INITIAL_MS = 100;
const POLL_BACKOFF_MAX_MS = 5_000;
const POLL_BACKOFF_MULTIPLIER = 1.5;
const WATCHDOG_INTERVAL_MS = 30_000;
// Live Performance buffer promote tick — drains cost-attached (PROMOTING) and
// retry-due buffer entries into `orders`. 5 s cadence keeps the seller's Live
// Performance page near-real-time after a cost edit. Runs in this long-lived
// process alongside the watchdog; the handler's FOR UPDATE SKIP LOCKED keeps it
// correct if more than one worker instance is deployed (and across overlapping
// ticks if a sweep ever runs longer than the interval).
const BUFFER_PROMOTE_INTERVAL_MS = 5_000;
// Self-healing webhook reconcile tick — keeps every ACTIVE TRENDYOL store's
// Trendyol webhook subscription healthy at the current PUBLIC_API_BASE_URL and
// prunes orphans. 5-min cadence (plus once on boot): webhooks are the primary
// ingest path and the hourly cron delta sync is the safety net, so the
// reconciler only heals drift (db reset, ngrok/base-URL change, failed connect)
// and need not run hot. Idempotent — steady state is one GET per seller, no writes.
const WEBHOOK_RECONCILE_INTERVAL_MS = 5 * 60_000;
// Variant-resolution tick — links order lines that persisted without a variant
// (spec 2026-06-11): local catalog first-match, then a targeted single-barcode
// vendor query. 60 s cadence: the seller's "eşleşme bekliyor" gap should close
// within a minute of the product appearing, while per-store batching + the
// per-item exponential backoff keep vendor traffic negligible.
const VARIANT_RESOLUTION_INTERVAL_MS = 60_000;
const IDLE_LOG_THROTTLE_MS = 30_000;

let shuttingDown = false;
function isShuttingDown(): boolean {
  return shuttingDown;
}

async function main(): Promise<void> {
  syncLog.info('worker.starting', { workerId: WORKER_ID });

  process.on('SIGTERM', () => {
    shuttingDown = true;
    syncLog.info('worker.shutdown.requested', { workerId: WORKER_ID, signal: 'SIGTERM' });
  });
  process.on('SIGINT', () => {
    shuttingDown = true;
    syncLog.info('worker.shutdown.requested', { workerId: WORKER_ID, signal: 'SIGINT' });
  });

  const watchdogTimer = setInterval(() => {
    sweepStaleClaims()
      .then((reapedCount) => {
        if (reapedCount > 0) {
          syncLog.info('watchdog.reaped', { workerId: WORKER_ID, count: reapedCount });
        }
      })
      .catch((err: unknown) => {
        syncLog.error('watchdog.error', {
          workerId: WORKER_ID,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
  }, WATCHDOG_INTERVAL_MS);

  const bufferPromoteTimer = setInterval(() => {
    void processBufferPromote().catch((err: unknown) => {
      syncLog.error('buffer.promote-tick-error', {
        workerId: WORKER_ID,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });
    // Past-day graduation: PENDING entries whose calendar day has ended are
    // graduated into `orders` as PROFIT-EXCLUDED (COST_DEADLINE_MISSED, spec
    // 2026-06-12) instead of being deleted at midnight — revenue is kept, the
    // profit fields stay permanently frozen.
    // Separate catch so a flush hiccup never stops the promote tick.
    void processPastDayBufferFlush().catch((err: unknown) => {
      syncLog.error('buffer.flush-tick-error', {
        workerId: WORKER_ID,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });
  }, BUFFER_PROMOTE_INTERVAL_MS);

  // Run once on boot so a freshly (re)started worker heals webhooks immediately
  // — e.g. right after a db reset that orphaned the old subscriptions — then on
  // the interval. Wrapped like buffer-promote so a Trendyol/DB hiccup never
  // crashes the worker.
  void processWebhookReconcile().catch((err: unknown) => {
    syncLog.error('webhook.reconcile-boot-error', {
      workerId: WORKER_ID,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  });
  const webhookReconcileTimer = setInterval(() => {
    void processWebhookReconcile().catch((err: unknown) => {
      syncLog.error('webhook.reconcile-tick-error', {
        workerId: WORKER_ID,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });
  }, WEBHOOK_RECONCILE_INTERVAL_MS);

  // Variant resolution: once on boot (a freshly restarted worker drains the
  // queue immediately — e.g. right after the daily product sync landed), then
  // on the interval. Wrapped like the other ticks so a vendor/DB hiccup never
  // crashes the worker.
  void processVariantResolution().catch((err: unknown) => {
    syncLog.error('resolution.boot-error', {
      workerId: WORKER_ID,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  });
  const variantResolutionTimer = setInterval(() => {
    void processVariantResolution().catch((err: unknown) => {
      syncLog.error('resolution.tick-error', {
        workerId: WORKER_ID,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });
  }, VARIANT_RESOLUTION_INTERVAL_MS);

  let backoff = POLL_BACKOFF_INITIAL_MS;
  let lastIdleLogAt = 0;

  while (!shuttingDown) {
    try {
      const claimed = await tryClaimNext(WORKER_ID);
      if (claimed === null) {
        const now = Date.now();
        if (now - lastIdleLogAt >= IDLE_LOG_THROTTLE_MS) {
          syncLog.info('worker.poll.idle', { workerId: WORKER_ID });
          lastIdleLogAt = now;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * POLL_BACKOFF_MULTIPLIER, POLL_BACKOFF_MAX_MS);
        continue;
      }
      backoff = POLL_BACKOFF_INITIAL_MS;
      lastIdleLogAt = 0;
      syncLog.info('worker.claim.acquired', {
        workerId: WORKER_ID,
        syncLogId: claimed.id,
        syncType: claimed.syncType,
        attemptCount: claimed.attemptCount,
      });

      try {
        syncLog.info('worker.run.start', {
          workerId: WORKER_ID,
          syncLogId: claimed.id,
          syncType: claimed.syncType,
        });
        await runSyncToCompletion(claimed, REGISTRY, isShuttingDown);
        syncLog.info('worker.run.complete', { workerId: WORKER_ID, syncLogId: claimed.id });
      } catch (err) {
        syncLog.error('worker.run.error', {
          workerId: WORKER_ID,
          syncLogId: claimed.id,
          errorCode: errorCodeOf(err),
          errorMessage: errorMessageOf(err),
        });
        await handleRunError(claimed.id, claimed.syncType, claimed.attemptCount, err);
      }
    } catch (loopErr) {
      // Outer catch protects against systemic failures (DB connection
      // dropped, malformed claim row, etc.). Back off the full max
      // window so we do not hot-spin while the underlying issue resolves.
      syncLog.error('worker.outer.error', {
        workerId: WORKER_ID,
        errorMessage: loopErr instanceof Error ? loopErr.message : String(loopErr),
      });
      await sleep(POLL_BACKOFF_MAX_MS);
    }
  }

  clearInterval(watchdogTimer);
  clearInterval(bufferPromoteTimer);
  clearInterval(webhookReconcileTimer);
  clearInterval(variantResolutionTimer);
  syncLog.info('worker.stopped', { workerId: WORKER_ID });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((fatal: unknown) => {
  syncLog.error('worker.fatal', {
    errorMessage: fatal instanceof Error ? fatal.message : String(fatal),
  });
  process.exit(1);
});
