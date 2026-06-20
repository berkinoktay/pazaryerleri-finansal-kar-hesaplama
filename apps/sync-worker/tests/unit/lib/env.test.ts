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
});
