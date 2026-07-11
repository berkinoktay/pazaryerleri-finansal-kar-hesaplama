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
//   3. Poll-and-claim loop feeding a bounded in-process worker pool
//      (SYNC_WORKER_CONCURRENCY, default 4). The loop keeps claiming while
//      the active set has room; a claimed job runs runSyncToCompletion +
//      handleRunError as an independent task. When the pool is full it
//      awaits the first task to finish (Promise.race); when nothing is
//      claimable it backs off exponentially. On a thrown error each task
//      classifies it (permanent → FAIL, transient → markRetryable with
//      exponential backoff up to MAX_ATTEMPTS) independently.
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

import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';
import { LostLeaseError, syncLog, tryClaimNext } from '@pazarsync/sync-core';

import { errorCodeOf } from './error-code';
import { processBufferPromote, processPastDayBufferFlush } from './handlers/buffer-promote';
import { processVariantResolution } from './handlers/variant-resolution';
import { processWebhookEventCleanup } from './handlers/webhook-event-cleanup';
import { processWebhookEventsBatch } from './handlers/webhook-events-consumer';
import { processWebhookReconcile } from './handlers/webhook-reconcile';
import { dbConnectivity } from './lib/db-connectivity';
import { assertCriticalDdl, MissingCriticalDdlError } from './lib/ddl-assertions';
import { readWorkerConcurrency, validateRequiredEnv } from './lib/env';
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
// Webhook-events consumer tick — drains the durable `webhook_events` ingest queue
// (Paket D): claims outstanding rows via a conditional-UPDATE lease and drives
// each through the shared processor in DB-only ('deferred') mode. 5 s cadence for
// the same near-real-time reason as the buffer promote tick — in deferred cutover
// the seller's Live Performance page lands a fresh order within ~5 s of the
// webhook. The lease closes the cross-writer simultaneous-claim race and the
// handler's own tickInFlight guard closes same-process overlap; a multi-instance
// deployment would need a renewed lease / SKIP LOCKED (single-instance today).
const WEBHOOK_EVENTS_CONSUMER_INTERVAL_MS = 5_000;
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
// Webhook-event retention cleanup tick — prunes `webhook_events` rows older than
// WEBHOOK_EVENT_RETENTION_DAYS (default 90). Daily cadence (plus once on boot):
// the table is an idempotency + raw-audit log that only grows, and nothing reads
// rows past the retention window, so a once-a-day batched delete is ample.
const WEBHOOK_EVENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;
const IDLE_LOG_THROTTLE_MS = 30_000;

let shuttingDown = false;
function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Drive one claimed sync job to completion and route any error, exactly as
 * the old single-job loop body did — extracted so the bounded pool can run
 * several of these concurrently as independent tasks.
 *
 * Contract: this NEVER rejects. Each error class is handled in place so a
 * task settling can only ever resolve — the pool tracks tasks in a Set and
 * races them, so a rejected task would surface as an unhandled rejection and
 * break slot accounting. LostLeaseError (the row was reaped/re-claimed by a
 * peer) is absorbed with a single warn and NO sync-log write, identical to
 * the pre-pool semantics.
 */
async function runClaimedJob(claimed: SyncLog): Promise<void> {
  try {
    syncLog.info('worker.run.start', {
      workerId: WORKER_ID,
      syncLogId: claimed.id,
      syncType: claimed.syncType,
    });
    const runStartedAt = Date.now();
    await runSyncToCompletion(claimed, REGISTRY, isShuttingDown, WORKER_ID);
    syncLog.info('worker.run.complete', {
      workerId: WORKER_ID,
      syncLogId: claimed.id,
      durationMs: Date.now() - runStartedAt,
    });
  } catch (err) {
    // Lease lost: a fenced write matched zero rows because the watchdog
    // reaper (or a peer that re-claimed after a stale sweep) now owns this
    // row. Check FIRST — the row belongs to another worker, so we must NOT
    // write any sync-log state (no markRetryable, no fail); doing so would
    // clobber the new owner's progress.
    if (err instanceof LostLeaseError) {
      syncLog.warn('sync.lease-lost', { workerId: err.workerId, syncLogId: err.syncLogId });
      return;
    }
    syncLog.error('worker.run.error', {
      workerId: WORKER_ID,
      syncLogId: claimed.id,
      errorCode: errorCodeOf(err),
      errorMessage: errorMessageOf(err),
    });
    try {
      await handleRunError(claimed.id, claimed.syncType, claimed.attemptCount, err, WORKER_ID);
    } catch (handleErr) {
      // handleRunError issues fenced writes (fail / markRetryable). If the
      // watchdog reaper (or a peer) took the row over WHILE we were handling
      // the original error, the fence throws LostLeaseError — the same
      // lease-lost outcome as the pre-check above. Absorb it here (one warn).
      if (handleErr instanceof LostLeaseError) {
        syncLog.warn('sync.lease-lost', {
          workerId: handleErr.workerId,
          syncLogId: handleErr.syncLogId,
        });
        return;
      }
      // A non-lease failure from the error handler is systemic (a DB write
      // failed while failing/retrying the row). In the single-job loop this
      // escaped to the outer catch. Here the task must not reject, so route it
      // to the same connectivity-aware event; if the DB is genuinely
      // unreachable the claim loop's own outer catch throttles polling.
      dbConnectivity.logBackgroundError('worker.run.handle-error', handleErr, {
        workerId: WORKER_ID,
        syncLogId: claimed.id,
      });
    }
  }
}

async function main(): Promise<void> {
  syncLog.info('worker.starting', { workerId: WORKER_ID });

  // Fail fast on a misconfigured environment (e.g. forgotten workspace-root
  // .env) with one clear message, instead of a Prisma/crypto error deep
  // inside the first sync. Exit non-zero so a supervisor restarts after the
  // operator fixes the config.
  let concurrency: number;
  try {
    validateRequiredEnv();
    concurrency = readWorkerConcurrency();
  } catch (err) {
    syncLog.error('worker.config-invalid', {
      workerId: WORKER_ID,
      errorMessage: err instanceof Error ? err.message : String(err),
      hint: 'Fix the environment configuration (workspace-root .env) and restart the worker.',
    });
    process.exit(1);
  }

  // Fail fast if the connected database is missing a correctness-critical
  // partial unique index that lives ONLY in supabase/sql (not mirrored into
  // Prisma migrations). A DB bootstrapped without the apply-policies step comes
  // up valid to Prisma but silently missing duplicate-job protection and fee
  // idempotency, producing wrong profit numbers with no error. This is the
  // first DB interaction, so it doubles as the boot connectivity check. Exit
  // non-zero (same contract as env validation) so a supervisor restarts once
  // the operator applies supabase/sql to the database.
  try {
    await assertCriticalDdl(prisma);
  } catch (err) {
    // Branch on the cause. A MissingCriticalDdlError means the DB is reachable
    // but supabase/sql was never applied — the actionable remediation is to run
    // apply-policies. Any other error here is the first DB round-trip failing
    // (connectivity, auth, wrong DATABASE_URL): the db:push hint would be
    // misleading, so route it to a distinct event with a generic message.
    if (err instanceof MissingCriticalDdlError) {
      syncLog.error('worker.ddl-invalid', {
        workerId: WORKER_ID,
        errorMessage: err.message,
        hint: 'Run `pnpm db:push` (dev) or the apply-policies deploy step so supabase/sql is applied to this database, then restart the worker.',
      });
    } else {
      syncLog.error('worker.boot-db-error', {
        workerId: WORKER_ID,
        errorMessage: err instanceof Error ? err.message : String(err),
        hint: 'The boot DDL check could not reach the database. Verify DATABASE_URL and that the database is up, then restart the worker.',
      });
    }
    process.exit(1);
  }

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
        dbConnectivity.logBackgroundError('watchdog.error', err, { workerId: WORKER_ID });
      });
  }, WATCHDOG_INTERVAL_MS);

  const bufferPromoteTimer = setInterval(() => {
    void processBufferPromote().catch((err: unknown) => {
      dbConnectivity.logBackgroundError('buffer.promote-tick-error', err, { workerId: WORKER_ID });
    });
    // Past-day graduation: PENDING entries whose calendar day has ended are
    // graduated into `orders` as PROFIT-EXCLUDED (COST_DEADLINE_MISSED, spec
    // 2026-06-12) instead of being deleted at midnight — revenue is kept, the
    // profit fields stay permanently frozen.
    // Separate catch so a flush hiccup never stops the promote tick.
    void processPastDayBufferFlush().catch((err: unknown) => {
      dbConnectivity.logBackgroundError('buffer.flush-tick-error', err, { workerId: WORKER_ID });
    });
  }, BUFFER_PROMOTE_INTERVAL_MS);

  // Run once on boot so a freshly (re)started worker heals webhooks immediately
  // — e.g. right after a db reset that orphaned the old subscriptions — then on
  // the interval. Wrapped like buffer-promote so a Trendyol/DB hiccup never
  // crashes the worker.
  void processWebhookReconcile().catch((err: unknown) => {
    dbConnectivity.logBackgroundError('webhook.reconcile-boot-error', err, { workerId: WORKER_ID });
  });
  const webhookReconcileTimer = setInterval(() => {
    void processWebhookReconcile().catch((err: unknown) => {
      dbConnectivity.logBackgroundError('webhook.reconcile-tick-error', err, {
        workerId: WORKER_ID,
      });
    });
  }, WEBHOOK_RECONCILE_INTERVAL_MS);

  // Run once on boot so a restarted worker prunes stale webhook_events rows
  // immediately, then on the daily interval. The table only ever grows (webhook
  // idempotency + raw audit log), so a batched retention delete keeps it bounded.
  // Wrapped like the other ticks so a DB hiccup never crashes the worker.
  void processWebhookEventCleanup().catch((err: unknown) => {
    dbConnectivity.logBackgroundError('webhook.event-cleanup-boot-error', err, {
      workerId: WORKER_ID,
    });
  });
  const webhookEventCleanupTimer = setInterval(() => {
    void processWebhookEventCleanup().catch((err: unknown) => {
      dbConnectivity.logBackgroundError('webhook.event-cleanup-tick-error', err, {
        workerId: WORKER_ID,
      });
    });
  }, WEBHOOK_EVENT_CLEANUP_INTERVAL_MS);

  // Webhook-events consumer: once on boot so a restarted worker drains any
  // outstanding queue rows immediately (e.g. deliveries received while the worker
  // was down), then on the 5 s interval. Wrapped like the other ticks so a
  // vendor/DB hiccup never crashes the worker; the lease gate makes it safe to
  // overlap a still-running tick.
  void processWebhookEventsBatch(prisma).catch((err: unknown) => {
    dbConnectivity.logBackgroundError('webhook.events-consumer-boot-error', err, {
      workerId: WORKER_ID,
    });
  });
  const webhookEventsConsumerTimer = setInterval(() => {
    void processWebhookEventsBatch(prisma).catch((err: unknown) => {
      dbConnectivity.logBackgroundError('webhook.events-consumer-tick-error', err, {
        workerId: WORKER_ID,
      });
    });
  }, WEBHOOK_EVENTS_CONSUMER_INTERVAL_MS);

  // Variant resolution: once on boot (a freshly restarted worker drains the
  // queue immediately — e.g. right after the daily product sync landed), then
  // on the interval. Wrapped like the other ticks so a vendor/DB hiccup never
  // crashes the worker.
  void processVariantResolution().catch((err: unknown) => {
    dbConnectivity.logBackgroundError('resolution.boot-error', err, { workerId: WORKER_ID });
  });
  const variantResolutionTimer = setInterval(() => {
    void processVariantResolution().catch((err: unknown) => {
      dbConnectivity.logBackgroundError('resolution.tick-error', err, { workerId: WORKER_ID });
    });
  }, VARIANT_RESOLUTION_INTERVAL_MS);

  syncLog.info('worker.pool.starting', { workerId: WORKER_ID, concurrency });

  let backoff = POLL_BACKOFF_INITIAL_MS;
  let lastIdleLogAt = 0;

  // The bounded worker pool: every in-flight job's task is tracked here so the
  // claim loop can (a) stop claiming once the set is full and (b) await all of
  // them at graceful shutdown. Each task self-removes on settle (see below),
  // so `active.size` is always the live in-flight count.
  const active = new Set<Promise<void>>();

  const spawnJob = (claimed: SyncLog): void => {
    // runClaimedJob never rejects by contract; this catch is defense so an
    // unnoticed future throw cannot surface as an unhandled rejection or kill
    // the Promise.race loop by rejecting the raced task.
    const task = runClaimedJob(claimed).catch(() => {});
    active.add(task);
    // Self-remove on settle. This reaction is registered at spawn time —
    // strictly before any `Promise.race(active)` reaction the loop attaches
    // later — so a task the race sees settle is already out of `active` (no
    // stale-slot double count). The task above always resolves, so `.finally`
    // always fires and the void'd derived promise never surfaces a rejection.
    void task.finally(() => {
      active.delete(task);
    });
  };

  while (!shuttingDown) {
    try {
      // Pool full — wait for the first job to finish before claiming more.
      if (active.size >= concurrency) {
        await Promise.race(active);
        continue;
      }

      const claimed = await tryClaimNext(WORKER_ID);
      // A poll that returns (claim or null) proves the DB is reachable —
      // clears any standing "db.unreachable" state with one "reconnected" line.
      dbConnectivity.reportDbHealthy();
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

      // Fire the job onto the pool and immediately loop to claim the next one
      // (up to the concurrency ceiling). runClaimedJob owns all error routing.
      spawnJob(claimed);
    } catch (loopErr) {
      // Outer catch protects against systemic CLAIM-side failures (DB
      // connection dropped, malformed claim row, etc.). DB-unreachable errors
      // collapse into a single throttled connectivity warning; anything else
      // logs loudly. Either way, back off the full max window so we do not
      // hot-spin while the underlying issue resolves. In-flight jobs keep
      // running — their own error routing is independent.
      dbConnectivity.logBackgroundError('worker.outer.error', loopErr, { workerId: WORKER_ID });
      await sleep(POLL_BACKOFF_MAX_MS);
    }
  }

  // Graceful shutdown: we stopped claiming when `shuttingDown` flipped. Let
  // every in-flight job drain — each checks shuttingDown() between chunks and
  // hands its row back to PENDING via releaseToPending, so a peer resumes from
  // the saved cursor. Tasks never reject, so allSettled is purely defensive.
  if (active.size > 0) {
    syncLog.info('worker.pool.draining', { workerId: WORKER_ID, inFlight: active.size });
    await Promise.allSettled(active);
  }

  clearInterval(watchdogTimer);
  clearInterval(bufferPromoteTimer);
  clearInterval(webhookReconcileTimer);
  clearInterval(webhookEventCleanupTimer);
  clearInterval(webhookEventsConsumerTimer);
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
