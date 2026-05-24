import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSyncEnv } from '../../../src/lib/env';

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
