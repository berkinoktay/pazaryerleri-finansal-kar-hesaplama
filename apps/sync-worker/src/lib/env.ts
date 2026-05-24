/**
 * Sync-worker environment reading + numeric validation.
 *
 * SYNC_HISTORICAL_BACKFILL_DAYS — how many days backward the initial
 * sync window walks. Production default = 0 (strict forward-only —
 * only orders created after store.createdAt). Dev/stage may set 90
 * for settlement testing against historical orders.
 *
 * SYNC_SAFETY_NET_HOURS — cron's per-tick lookback window. Webhook
 * is the primary ingest path; cron sweeps the trailing N hours to
 * catch anything the webhook missed (delivery failure, our downtime).
 */

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
