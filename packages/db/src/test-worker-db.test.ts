import { describe, expect, it } from 'vitest';

import {
  adminDatabaseUrl,
  cloneNamePattern,
  templateDatabaseUrl,
  workerDatabaseUrl,
} from './test-env';

// TEST_DATABASE_URL: the base name every test database derives from.
const TEMPLATE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/pazarsync_test';

describe('templateDatabaseUrl', () => {
  it('names the clone template after the test DB, separate from the test DB itself', () => {
    expect(templateDatabaseUrl(TEMPLATE_URL)).toBe(
      'postgresql://postgres:postgres@127.0.0.1:54322/pazarsync_test_tpl',
    );
  });

  it('refuses the shared "postgres" database as a base', () => {
    expect(() =>
      templateDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
    ).toThrow(/postgres/);
  });
});

describe('workerDatabaseUrl', () => {
  it('derives a per-package, per-worker clone of the template database', () => {
    expect(workerDatabaseUrl(TEMPLATE_URL, 'api', '3')).toBe(
      'postgresql://postgres:postgres@127.0.0.1:54322/pazarsync_test_api_w3',
    );
  });

  it('keeps credentials, host, port and query parameters', () => {
    expect(
      workerDatabaseUrl('postgresql://u:p@db.local:6543/tmpl?sslmode=disable', 'profit', '1'),
    ).toBe('postgresql://u:p@db.local:6543/tmpl_profit_w1?sslmode=disable');
  });

  it('rejects a prefix that is not plain lowercase letters', () => {
    expect(() => workerDatabaseUrl(TEMPLATE_URL, 'Api-1', '1')).toThrow(/prefix/);
  });

  it('rejects a pool id that is not a positive integer', () => {
    expect(() => workerDatabaseUrl(TEMPLATE_URL, 'api', '0')).toThrow(/pool id/);
    expect(() => workerDatabaseUrl(TEMPLATE_URL, 'api', 'x')).toThrow(/pool id/);
  });

  it('refuses to derive clones from the shared "postgres" database', () => {
    expect(() =>
      workerDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'api', '1'),
    ).toThrow(/postgres/);
  });
});

describe('adminDatabaseUrl', () => {
  it('points the same server at the maintenance "postgres" database', () => {
    expect(adminDatabaseUrl(TEMPLATE_URL)).toBe(
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    );
  });
});

describe('cloneNamePattern', () => {
  it('matches only clones of the given template and package', () => {
    const pattern = cloneNamePattern('pazarsync_test', 'api');
    expect(pattern.test('pazarsync_test_api_w1')).toBe(true);
    expect(pattern.test('pazarsync_test_api_w12')).toBe(true);
    expect(pattern.test('pazarsync_test')).toBe(false);
    expect(pattern.test('pazarsync_test_tpl')).toBe(false);
    expect(pattern.test('pazarsync_test_profit_w1')).toBe(false);
    expect(pattern.test('postgres')).toBe(false);
    expect(pattern.test('pazarsync_test_api_w1; DROP DATABASE postgres')).toBe(false);
  });
});
