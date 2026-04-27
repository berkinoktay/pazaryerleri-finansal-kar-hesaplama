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
//   - CORRUPT_CHECKPOINT → the row's pageCursor is unparseable; future
//     claims would crash on the same data. Terminal FAIL.
//   - All other errors → transient (network blip, marketplace 5xx,
//     transient DB failure). markRetryable bumps the row to
//     FAILED_RETRYABLE with `nextAttemptAt` set by the backoff schedule
//     in syncLogService.markRetryable. Once attemptCount reaches
//     MAX_ATTEMPTS we give up and mark the row terminally FAILED.

import { randomBytes } from 'node:crypto';

import { markRetryable, syncLogService, tryClaimNext } from '@pazarsync/sync-core';

import type { Registry } from './dispatcher';
import { productsHandler } from './handlers/products';
import { runSyncToCompletion } from './loop';
import { sweepStaleClaims } from './watchdog';

const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`;
const POLL_BACKOFF_INITIAL_MS = 100;
const POLL_BACKOFF_MAX_MS = 5_000;
const POLL_BACKOFF_MULTIPLIER = 1.5;
const WATCHDOG_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;

// Permanent failure codes — markFailed terminally, never markRetryable.
// Adding a new permanent code? Update this set + add a comment in the
// handler that throws it explaining why retry would not help.
const PERMANENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'MARKETPLACE_AUTH_FAILED',
  'MARKETPLACE_ACCESS_DENIED',
  'CORRUPT_CHECKPOINT',
]);

const REGISTRY: Registry = {
  PRODUCTS: productsHandler,
  // ORDERS, SETTLEMENTS will register here as they land.
};

let shuttingDown = false;
function isShuttingDown(): boolean {
  return shuttingDown;
}

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] sync-worker starting`);

  process.on('SIGTERM', () => {
    shuttingDown = true;
    console.log(`[${WORKER_ID}] SIGTERM received`);
  });
  process.on('SIGINT', () => {
    shuttingDown = true;
    console.log(`[${WORKER_ID}] SIGINT received`);
  });

  const watchdogTimer = setInterval(() => {
    sweepStaleClaims().catch((err: unknown) => {
      console.error(`[${WORKER_ID}] watchdog error`, err);
    });
  }, WATCHDOG_INTERVAL_MS);

  let backoff = POLL_BACKOFF_INITIAL_MS;

  while (!shuttingDown) {
    try {
      const claimed = await tryClaimNext(WORKER_ID);
      if (claimed === null) {
        await sleep(backoff);
        backoff = Math.min(backoff * POLL_BACKOFF_MULTIPLIER, POLL_BACKOFF_MAX_MS);
        continue;
      }
      backoff = POLL_BACKOFF_INITIAL_MS;
      console.log(`[${WORKER_ID}] claimed sync_log ${claimed.id} (${claimed.syncType})`);

      try {
        await runSyncToCompletion(claimed, REGISTRY, isShuttingDown);
      } catch (err) {
        await handleRunError(claimed.id, claimed.attemptCount, err);
      }
    } catch (loopErr) {
      // Outer catch protects against systemic failures (DB connection
      // dropped, malformed claim row, etc.). Back off the full max
      // window so we do not hot-spin while the underlying issue resolves.
      console.error(`[${WORKER_ID}] outer loop error`, loopErr);
      await sleep(POLL_BACKOFF_MAX_MS);
    }
  }

  clearInterval(watchdogTimer);
  console.log(`[${WORKER_ID}] sync-worker stopped`);
}

async function handleRunError(
  syncLogId: string,
  attemptCount: number,
  err: unknown,
): Promise<void> {
  const code = errorCodeOf(err);
  const message = errorMessageOf(err);

  if (PERMANENT_FAILURE_CODES.has(code)) {
    await syncLogService.fail(syncLogId, code, message);
    return;
  }

  if (attemptCount >= MAX_ATTEMPTS) {
    await syncLogService.fail(syncLogId, code, `${message} (max retries reached)`);
    return;
  }

  await markRetryable(syncLogId, attemptCount, code, message);
}

/**
 * Narrow an unknown caught value to extract its `code` string, if any.
 * Mirrors the structural-narrowing pattern used in
 * `apps/api/src/lib/map-prisma-error.ts` and `sync-log.service.ts`'s
 * `isUniqueViolation` — the documented exception in CLAUDE.md for
 * runtime structural type guards on third-party / unknown shapes.
 */
function errorCodeOf(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  return 'INTERNAL_ERROR';
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((fatal: unknown) => {
  console.error('[sync-worker] fatal error', fatal);
  process.exit(1);
});
