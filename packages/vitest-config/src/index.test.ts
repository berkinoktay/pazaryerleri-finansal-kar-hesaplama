import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testWorkers } from './index';

const KNOBS = ['PAZARSYNC_TEST_WORKERS', 'CI', 'VITEST_MAX_WORKERS'] as const;
let saved: Partial<Record<(typeof KNOBS)[number], string>>;

beforeEach(() => {
  saved = {};
  for (const key of KNOBS) {
    const value = process.env[key];
    if (value !== undefined) saved[key] = value;
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KNOBS) {
    delete process.env[key];
    const value = saved[key];
    if (value !== undefined) process.env[key] = value;
  }
});

describe('testWorkers', () => {
  it('returns an explicit worker count as a number', () => {
    process.env['PAZARSYNC_TEST_WORKERS'] = '4';
    expect(testWorkers()).toBe(4);
  });

  it('passes a percentage through as a string', () => {
    process.env['PAZARSYNC_TEST_WORKERS'] = '50%';
    expect(testWorkers()).toBe('50%');
  });

  it('rejects a value that is neither a count nor a percentage', () => {
    process.env['PAZARSYNC_TEST_WORKERS'] = 'abc';
    expect(() => testWorkers()).toThrow(/PAZARSYNC_TEST_WORKERS/);
  });

  // vitest treats maxWorkers 0 as "unset" and opens one worker per core — the
  // exact oversubscription this knob exists to prevent.
  it.each(['0', '0%', '00'])(
    'rejects %s instead of letting vitest fall back to every core',
    (value) => {
      process.env['PAZARSYNC_TEST_WORKERS'] = value;
      expect(() => testWorkers()).toThrow(/PAZARSYNC_TEST_WORKERS/);
    },
  );

  it('rejects an empty value instead of treating it as unset', () => {
    process.env['PAZARSYNC_TEST_WORKERS'] = '';
    expect(() => testWorkers()).toThrow(/PAZARSYNC_TEST_WORKERS/);
  });

  it('defaults to 2 workers in CI', () => {
    process.env['CI'] = 'true';
    expect(testWorkers()).toBe(2);
  });

  it('defaults to half the machine locally', () => {
    expect(testWorkers()).toBe('50%');
  });

  // Matches vitest's own CI detection (std-env): an explicitly false-y CI is local.
  it.each(['false', '0', ''])('treats CI=%j as a local run', (value) => {
    process.env['CI'] = value;
    expect(testWorkers()).toBe('50%');
  });

  it('lets the explicit knob win over the CI default', () => {
    process.env['CI'] = 'true';
    process.env['PAZARSYNC_TEST_WORKERS'] = '1';
    expect(testWorkers()).toBe(1);
  });
});

describe('module import', () => {
  it('removes VITEST_MAX_WORKERS so it cannot override the resolved pool', async () => {
    process.env['VITEST_MAX_WORKERS'] = '7';
    vi.resetModules();
    await import('./index');
    expect(process.env['VITEST_MAX_WORKERS']).toBeUndefined();
  });
});
