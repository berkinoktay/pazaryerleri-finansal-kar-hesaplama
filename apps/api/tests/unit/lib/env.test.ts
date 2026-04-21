import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireEnv, validateRequiredEnv } from '../../../src/lib/env';

describe('requireEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the value when set', () => {
    vi.stubEnv('PAZARSYNC_TEST_VAR', 'actual-value');
    expect(requireEnv('PAZARSYNC_TEST_VAR')).toBe('actual-value');
  });

  it('throws when the value is an empty string', () => {
    vi.stubEnv('PAZARSYNC_TEST_VAR', '');
    expect(() => requireEnv('PAZARSYNC_TEST_VAR')).toThrow(/PAZARSYNC_TEST_VAR/);
  });

  it('error message mentions where to configure the variable', () => {
    vi.stubEnv('PAZARSYNC_TEST_VAR', '');
    expect(() => requireEnv('PAZARSYNC_TEST_VAR')).toThrow(/\.env/);
  });
});

describe('validateRequiredEnv', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://fake/fake');
    vi.stubEnv(
      'ENCRYPTION_KEY',
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_fake');
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', 'https://apigw.trendyol.com');
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', 'https://stageapigw.trendyol.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not throw when every required var is set', () => {
    expect(() => validateRequiredEnv()).not.toThrow();
  });

  it('throws and names DATABASE_URL when it is missing', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => validateRequiredEnv()).toThrow(/DATABASE_URL/);
  });

  it('throws and names ENCRYPTION_KEY when it is missing', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => validateRequiredEnv()).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws and names SUPABASE_URL when it is missing', () => {
    vi.stubEnv('SUPABASE_URL', '');
    expect(() => validateRequiredEnv()).toThrow(/SUPABASE_URL/);
  });

  it('throws and names SUPABASE_SECRET_KEY when it is missing', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(() => validateRequiredEnv()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('throws and names TRENDYOL_PROD_BASE_URL when it is missing', () => {
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', '');
    expect(() => validateRequiredEnv()).toThrow(/TRENDYOL_PROD_BASE_URL/);
  });

  it('throws and names TRENDYOL_SANDBOX_BASE_URL when it is missing', () => {
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', '');
    expect(() => validateRequiredEnv()).toThrow(/TRENDYOL_SANDBOX_BASE_URL/);
  });
});
