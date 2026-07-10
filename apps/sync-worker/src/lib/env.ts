/**
 * Sync-worker environment reading + numeric validation.
 *
 * SYNC_HISTORICAL_BACKFILL_DAYS — how many days backward the initial
 * sync window walks. Production default = 0 (strict forward-only —
 * only orders created after store.createdAt). Dev/stage may set 90
 * for settlement testing against historical orders. A positive value is
 * fail-closed: validateRequiredEnv() rejects it unless
 * ALLOW_HISTORICAL_BACKFILL=true is also set (see below), so it can never
 * be enabled by accident in production.
 *
 * ALLOW_HISTORICAL_BACKFILL — explicit acknowledgement that a positive
 * SYNC_HISTORICAL_BACKFILL_DAYS is intended. Must be the literal 'true'.
 * Dev/stage-only: backfilled pre-connect orders carry cost snapshots from
 * before the store's costs existed, so their profit numbers are wrong — this
 * opt-in exists so that footgun is never armed silently.
 *
 * SYNC_SAFETY_NET_HOURS — cron's per-tick lookback window. Webhook
 * is the primary ingest path; cron sweeps the trailing N hours to
 * catch anything the webhook missed (delivery failure, our downtime).
 *
 * WEBHOOK_PRUNE_EXTRA_BASE_URLS — optional, runtime-only (read directly by the
 * webhook-reconcile handler, not validated here): a comma-separated list of
 * RETIRED public base URLs whose leftover Trendyol subscriptions the reconciler
 * should additionally prune after PUBLIC_API_BASE_URL changed. Unset in normal
 * setups; no boot/test-env wiring needed.
 *
 * WEBHOOK_EVENT_RETENTION_DAYS — how many days of `webhook_events` rows
 * the daily cleanup tick keeps. Optional; defaults to 90. Read directly by
 * the webhook-event-cleanup handler (not via readSyncEnv), so it is not
 * validated here — an unset/invalid value falls back to the default (an
 * invalid value additionally warns once).
 */

import { syncLog } from '@pazarsync/sync-core';
import { requireEnv } from '@pazarsync/utils';

interface SyncEnv {
  historicalBackfillDays: number;
  safetyNetHours: number;
}

function parseNonNegativeInt(varName: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${varName} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function parsePositiveInt(varName: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${varName} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function readSyncEnv(): SyncEnv {
  return {
    historicalBackfillDays: parseNonNegativeInt(
      'SYNC_HISTORICAL_BACKFILL_DAYS',
      process.env['SYNC_HISTORICAL_BACKFILL_DAYS'],
      0,
    ),
    safetyNetHours: parsePositiveInt(
      'SYNC_SAFETY_NET_HOURS',
      process.env['SYNC_SAFETY_NET_HOURS'],
      8,
    ),
  };
}

// Worker-specific required vars — deliberately NARROWER than apps/api's:
// the worker uses Prisma (DATABASE_URL) + credential decryption
// (ENCRYPTION_KEY) + the Trendyol adapter base URLs, but never touches
// SUPABASE_URL / SUPABASE_SECRET_KEY (no Supabase Auth or JS client calls).
const REQUIRED_ENV = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'TRENDYOL_PROD_BASE_URL',
  'TRENDYOL_SANDBOX_BASE_URL',
] as const;

/**
 * Fail fast at worker boot if a required env var is missing. Called first
 * thing in `main()` so a misconfigured deployment (or a forgotten local
 * `.env`) surfaces immediately with a clear message, instead of throwing a
 * Prisma/crypto error deep inside the first sync.
 *
 * `PUBLIC_API_BASE_URL` is recommended-not-required: without it the webhook
 * reconcile tick is disabled (the hourly cron is the safety net), so a
 * missing value is a one-time warning rather than a boot failure.
 */
export function validateRequiredEnv(): void {
  for (const key of REQUIRED_ENV) {
    requireEnv(key);
  }

  // SYNC_HISTORICAL_BACKFILL_DAYS is a dev/stage-only escape hatch for testing
  // settlement reconciliation against historical orders. Backfilling pre-connect
  // orders predates the store's cost snapshots, so their profit would be computed
  // against costs that did not exist yet — silently wrong numbers. This is
  // fail-closed and does NOT key off NODE_ENV: production images do not set
  // NODE_ENV (verified in the worker Dockerfile), so a NODE_ENV gate would fail
  // OPEN in prod. Instead any positive backfill requires an explicit
  // ALLOW_HISTORICAL_BACKFILL=true acknowledgement — absent it, boot fails.
  const historicalBackfillDays = parseNonNegativeInt(
    'SYNC_HISTORICAL_BACKFILL_DAYS',
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'],
    0,
  );
  if (historicalBackfillDays > 0 && process.env['ALLOW_HISTORICAL_BACKFILL'] !== 'true') {
    throw new Error(
      `SYNC_HISTORICAL_BACKFILL_DAYS is a dev/stage-only escape hatch and is set to ` +
        `"${process.env['SYNC_HISTORICAL_BACKFILL_DAYS']}". Historical backfill reads pre-connect ` +
        `orders whose cost snapshots would be wrong (silently incorrect profit), so it must NEVER ` +
        `be enabled in production. To acknowledge this in dev/stage, set ` +
        `ALLOW_HISTORICAL_BACKFILL=true; otherwise leave SYNC_HISTORICAL_BACKFILL_DAYS at 0.`,
    );
  }

  const publicApiBaseUrl = process.env['PUBLIC_API_BASE_URL'];
  if (publicApiBaseUrl === undefined || publicApiBaseUrl.length === 0) {
    syncLog.warn('worker.config.webhook-disabled', {
      hint:
        'PUBLIC_API_BASE_URL is not set — Trendyol webhook reconcile is disabled ' +
        '(the hourly cron remains the safety net). Set it to your public https URL to enable webhooks.',
    });
  }
}
