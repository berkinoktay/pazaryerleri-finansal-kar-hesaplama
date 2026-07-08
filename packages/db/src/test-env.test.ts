import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractDbName, remapDatabaseUrlToTestDb } from './test-env';

const DEV_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TEST_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/pazarsync_test';

const ENV_KEYS = [
  'CI',
  'PAZARSYNC_SKIP_RESEED',
  'TEST_DATABASE_URL',
  'DATABASE_URL',
  'DIRECT_URL',
  'PAZARSYNC_DEV_DATABASE_URL',
] as const;

describe('extractDbName', () => {
  it('returns the last path segment as the database name', () => {
    expect(extractDbName(TEST_URL)).toBe('pazarsync_test');
    expect(extractDbName(DEV_URL)).toBe('postgres');
  });

  it('ignores query params and a trailing slash', () => {
    expect(extractDbName('postgresql://u:p@h:5432/mydb?schema=public')).toBe('mydb');
    expect(extractDbName('postgresql://u:p@h:5432/mydb/')).toBe('mydb');
  });
});

describe('remapDatabaseUrlToTestDb', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    // Deterministic baseline: a local, DB-touching run (no CI, no skip-reseed).
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['DATABASE_URL'] = DEV_URL;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('throws when TEST_DATABASE_URL is missing on a local DB-touching run', () => {
    expect(() => remapDatabaseUrlToTestDb()).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it('throws when TEST_DATABASE_URL points at the "postgres" dev DB', () => {
    process.env['TEST_DATABASE_URL'] = DEV_URL;
    expect(() => remapDatabaseUrlToTestDb()).toThrow(/"postgres" database/);
  });

  it('throws when TEST_DATABASE_URL names the same DB as DATABASE_URL', () => {
    process.env['DATABASE_URL'] = 'postgresql://u:p@h:5432/devdb';
    process.env['TEST_DATABASE_URL'] = 'postgresql://u:p@h:5432/devdb';
    expect(() => remapDatabaseUrlToTestDb()).toThrow(/same database/);
  });

  it('remaps DATABASE_URL/DIRECT_URL and stashes the dev URL for a distinct test DB', () => {
    process.env['TEST_DATABASE_URL'] = TEST_URL;
    remapDatabaseUrlToTestDb();
    expect(process.env['DATABASE_URL']).toBe(TEST_URL);
    expect(process.env['DIRECT_URL']).toBe(TEST_URL);
    expect(process.env['PAZARSYNC_DEV_DATABASE_URL']).toBe(DEV_URL);
  });

  it('is a no-op on a DB-free unit run with no TEST_DATABASE_URL', () => {
    process.env['PAZARSYNC_SKIP_RESEED'] = '1';
    expect(() => remapDatabaseUrlToTestDb()).not.toThrow();
    expect(process.env['DATABASE_URL']).toBe(DEV_URL);
  });

  it('skips the guard in CI even when TEST_DATABASE_URL equals DATABASE_URL', () => {
    process.env['CI'] = 'true';
    process.env['TEST_DATABASE_URL'] = DEV_URL;
    expect(() => remapDatabaseUrlToTestDb()).not.toThrow();
    expect(process.env['DATABASE_URL']).toBe(DEV_URL);
    expect(process.env['DIRECT_URL']).toBe(DEV_URL);
  });
});
