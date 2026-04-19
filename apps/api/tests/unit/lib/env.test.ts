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
    vi.stubEnv('JWT_SECRET', 'fake-secret-at-least-32-bytes-long-0000');
    vi.stubEnv(
      'ENCRYPTION_KEY',
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not throw when every required var is set', () => {
    expect(() => validateRequiredEnv()).not.toThrow();
  });

  it('throws and names JWT_SECRET when it is missing', () => {
    vi.stubEnv('JWT_SECRET', '');
    expect(() => validateRequiredEnv()).toThrow(/JWT_SECRET/);
  });

  it('throws and names ENCRYPTION_KEY when it is missing', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => validateRequiredEnv()).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws and names DATABASE_URL when it is missing', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => validateRequiredEnv()).toThrow(/DATABASE_URL/);
  });
});
