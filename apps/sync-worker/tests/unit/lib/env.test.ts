import { syncLog } from '@pazarsync/sync-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSyncEnv, validateRequiredEnv } from '../../../src/lib/env';

describe('readSyncEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  it('returns defaults when env vars are unset', () => {
    delete process.env['SYNC_HISTORICAL_BACKFILL_DAYS'];
    delete process.env['SYNC_SAFETY_NET_HOURS'];
    expect(readSyncEnv()).toEqual({
      historicalBackfillDays: 0,
      safetyNetHours: 8,
    });
  });

  it('parses valid integer values', () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '90';
    process.env['SYNC_SAFETY_NET_HOURS'] = '12';
    expect(readSyncEnv()).toEqual({
      historicalBackfillDays: 90,
      safetyNetHours: 12,
    });
  });

  it('throws on non-numeric SYNC_HISTORICAL_BACKFILL_DAYS', () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = 'abc';
    expect(() => readSyncEnv()).toThrow(
      'SYNC_HISTORICAL_BACKFILL_DAYS must be a non-negative integer, got "abc"',
    );
  });

  it('throws on negative SYNC_HISTORICAL_BACKFILL_DAYS', () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '-1';
    expect(() => readSyncEnv()).toThrow(
      'SYNC_HISTORICAL_BACKFILL_DAYS must be a non-negative integer, got "-1"',
    );
  });

  it('throws on zero SYNC_SAFETY_NET_HOURS', () => {
    process.env['SYNC_SAFETY_NET_HOURS'] = '0';
    expect(() => readSyncEnv()).toThrow(
      'SYNC_SAFETY_NET_HOURS must be a positive integer, got "0"',
    );
  });
});

describe('validateRequiredEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = {
      ...original,
      DATABASE_URL: 'postgresql://user:pass@127.0.0.1:54322/postgres',
      ENCRYPTION_KEY: 'deadbeef',
      TRENDYOL_PROD_BASE_URL: 'https://apigw.trendyol.com',
      TRENDYOL_SANDBOX_BASE_URL: 'https://stageapigw.trendyol.com',
      PUBLIC_API_BASE_URL: 'https://app.example.com',
    };
    // Normalize the backfill escape hatch to its safe default (unset ->
    // parses to 0). A developer's local .env may set
    // SYNC_HISTORICAL_BACKFILL_DAYS=90 for settlement testing; without this
    // it would leak in through `...original` and trip the fail-closed guard in
    // cases that never opt in. Each case that needs a positive value sets it.
    delete process.env['SYNC_HISTORICAL_BACKFILL_DAYS'];
    delete process.env['ALLOW_HISTORICAL_BACKFILL'];
  });

  afterEach(() => {
    process.env = original;
    vi.restoreAllMocks();
  });

  it.each([
    'DATABASE_URL',
    'ENCRYPTION_KEY',
    'TRENDYOL_PROD_BASE_URL',
    'TRENDYOL_SANDBOX_BASE_URL',
  ])('throws when required %s is missing', (key) => {
    delete process.env[key];
    expect(() => validateRequiredEnv()).toThrow(new RegExp(key));
  });

  it('does not throw when every required var is present', () => {
    expect(() => validateRequiredEnv()).not.toThrow();
  });

  it('warns without throwing when PUBLIC_API_BASE_URL is missing', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => {});
    delete process.env['PUBLIC_API_BASE_URL'];
    expect(() => validateRequiredEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      'worker.config.webhook-disabled',
      expect.objectContaining({ hint: expect.any(String) }),
    );
  });

  it('does not warn about webhooks when PUBLIC_API_BASE_URL is set', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => {});
    validateRequiredEnv();
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws when SYNC_HISTORICAL_BACKFILL_DAYS > 0 without the ALLOW_HISTORICAL_BACKFILL opt-in (regardless of NODE_ENV)', () => {
    // Fail-closed: prod images do not set NODE_ENV, so the guard must not key
    // off it. Even in 'development' a positive backfill is rejected until the
    // operator explicitly acknowledges via ALLOW_HISTORICAL_BACKFILL=true.
    process.env['NODE_ENV'] = 'development';
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '90';
    delete process.env['ALLOW_HISTORICAL_BACKFILL'];
    expect(() => validateRequiredEnv()).toThrow(/SYNC_HISTORICAL_BACKFILL_DAYS/);
  });

  it('throws when SYNC_HISTORICAL_BACKFILL_DAYS > 0 and ALLOW_HISTORICAL_BACKFILL is not the literal "true"', () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '90';
    process.env['ALLOW_HISTORICAL_BACKFILL'] = '1';
    expect(() => validateRequiredEnv()).toThrow(/SYNC_HISTORICAL_BACKFILL_DAYS/);
  });

  it('does not throw when SYNC_HISTORICAL_BACKFILL_DAYS > 0 and ALLOW_HISTORICAL_BACKFILL=true (dev/stage escape hatch acknowledged)', () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '90';
    process.env['ALLOW_HISTORICAL_BACKFILL'] = 'true';
    expect(() => validateRequiredEnv()).not.toThrow();
  });

  it('does not throw when SYNC_HISTORICAL_BACKFILL_DAYS is 0 (opt-in irrelevant)', () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '0';
    delete process.env['ALLOW_HISTORICAL_BACKFILL'];
    expect(() => validateRequiredEnv()).not.toThrow();
  });

  it('does not throw when SYNC_HISTORICAL_BACKFILL_DAYS is unset (default 0)', () => {
    delete process.env['SYNC_HISTORICAL_BACKFILL_DAYS'];
    delete process.env['ALLOW_HISTORICAL_BACKFILL'];
    expect(() => validateRequiredEnv()).not.toThrow();
  });
});
