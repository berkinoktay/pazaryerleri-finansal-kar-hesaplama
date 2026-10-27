import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SCRATCH_DATABASE_PREFIX,
  buildMigrationFolderName,
  buildScratchDatabaseName,
  deriveScratchDatabaseUrl,
  formatMigrationTimestamp,
  isLoopbackDatabaseUrl,
  isScratchDatabaseName,
  isValidMigrationName,
} from './migration-tooling';
import { extractDbName } from './test-env';

const FIXED_DATE = new Date('2026-10-27T08:05:09.000Z');
const SCRATCH_SUFFIX = 'a1b2c3d4';
const POSTGRES_MAX_IDENTIFIER_LENGTH = 63;
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('isValidMigrationName', () => {
  it.each(['catch_up_schema_drift', 'add_product_variant_status', 'v2_index', 'a'])(
    'accepts %s',
    (name) => {
      expect(isValidMigrationName(name)).toBe(true);
    },
  );

  it.each(['', 'Catch_up', '1_init', '_leading', 'drop-columns', 'two words', 'name.sql'])(
    'rejects "%s"',
    (name) => {
      expect(isValidMigrationName(name)).toBe(false);
    },
  );
});

describe('formatMigrationTimestamp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders YYYYMMDDHHMMSS', () => {
    expect(formatMigrationTimestamp(FIXED_DATE)).toBe('20261027080509');
  });

  it('uses UTC even when the local time zone is ahead of it', () => {
    vi.stubEnv('TZ', 'Europe/Istanbul');
    // 22:30 UTC is already 01:30 on the next day in Istanbul (UTC+3).
    expect(formatMigrationTimestamp(new Date('2026-10-27T22:30:00.000Z'))).toBe('20261027223000');
  });
});

describe('buildMigrationFolderName', () => {
  it('prefixes the name with the UTC timestamp', () => {
    expect(buildMigrationFolderName('catch_up_schema_drift', FIXED_DATE)).toBe(
      '20261027080509_catch_up_schema_drift',
    );
  });

  it('sorts after the existing folders, the order Prisma applies them in', () => {
    const existing = ['0_init', '20260712153314_sync_logs_freshness_index'];
    const created = buildMigrationFolderName('catch_up_schema_drift', FIXED_DATE);
    expect([created, ...existing].sort()).toEqual([...existing, created]);
  });

  it('throws on an invalid name', () => {
    expect(() => buildMigrationFolderName('Drop-Columns', FIXED_DATE)).toThrow(
      /Invalid migration name/,
    );
  });
});

describe('scratch database names', () => {
  it('builds a prefixed, timestamped name', () => {
    expect(buildScratchDatabaseName(FIXED_DATE, SCRATCH_SUFFIX)).toBe(
      'pazarsync_scratch_20261027080509_a1b2c3d4',
    );
  });

  it('stays within the Postgres identifier length limit', () => {
    const longest = buildScratchDatabaseName(FIXED_DATE, 'f'.repeat(16));
    expect(longest.length).toBeLessThanOrEqual(POSTGRES_MAX_IDENTIFIER_LENGTH);
  });

  it.each(['', 'A1B2', 'x;drop', 'f'.repeat(17)])('rejects the suffix "%s"', (suffix) => {
    expect(() => buildScratchDatabaseName(FIXED_DATE, suffix)).toThrow(
      /Invalid scratch database suffix/,
    );
  });

  it('recognises only names it builds', () => {
    expect(isScratchDatabaseName(buildScratchDatabaseName(FIXED_DATE, SCRATCH_SUFFIX))).toBe(true);
    expect(isScratchDatabaseName('postgres')).toBe(false);
    expect(isScratchDatabaseName('pazarsync_test')).toBe(false);
    expect(isScratchDatabaseName(`${SCRATCH_DATABASE_PREFIX}_manual`)).toBe(false);
  });
});

describe('deriveScratchDatabaseUrl', () => {
  const scratchName = buildScratchDatabaseName(FIXED_DATE, SCRATCH_SUFFIX);

  it('swaps only the database name', () => {
    expect(deriveScratchDatabaseUrl(`${LOCAL_URL}?schema=public`, scratchName)).toBe(
      `postgresql://postgres:postgres@127.0.0.1:54322/${scratchName}?schema=public`,
    );
  });

  it('keeps percent-encoded credentials intact', () => {
    const derived = deriveScratchDatabaseUrl(
      'postgresql://app:p%40ss@127.0.0.1:5432/app',
      scratchName,
    );
    expect(derived).toBe(`postgresql://app:p%40ss@127.0.0.1:5432/${scratchName}`);
    expect(extractDbName(derived)).toBe(scratchName);
  });

  it('refuses a database name the tooling did not build', () => {
    expect(() => deriveScratchDatabaseUrl(LOCAL_URL, 'postgres')).toThrow(
      /not a scratch database name/,
    );
  });
});

describe('isLoopbackDatabaseUrl', () => {
  it.each([
    LOCAL_URL,
    'postgresql://postgres:postgres@localhost:54322/postgres',
    'postgresql://postgres@[::1]:54322/postgres',
  ])('accepts %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(true);
  });

  it('rejects a remote server', () => {
    expect(isLoopbackDatabaseUrl('postgresql://db.example.com:5432/postgres')).toBe(false);
  });

  it('rejects a host query parameter, which pg prefers over the URL host', () => {
    expect(isLoopbackDatabaseUrl(`${LOCAL_URL}?host=db.example.com`)).toBe(false);
  });

  it('fails closed on a malformed URL instead of throwing', () => {
    expect(isLoopbackDatabaseUrl('postgresql://postgres:p#ss@127.0.0.1:54322/postgres')).toBe(
      false,
    );
    expect(isLoopbackDatabaseUrl('not a url')).toBe(false);
  });
});
