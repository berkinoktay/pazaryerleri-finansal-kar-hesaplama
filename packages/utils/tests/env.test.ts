import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireEnv } from '../src/env';

describe('requireEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  it('returns the value when the variable is set', () => {
    process.env['SOME_KEY'] = 'a-value';
    expect(requireEnv('SOME_KEY')).toBe('a-value');
  });

  it('throws when the variable is missing', () => {
    delete process.env['SOME_KEY'];
    expect(() => requireEnv('SOME_KEY')).toThrow(/SOME_KEY/);
  });

  it('throws when the variable is an empty string', () => {
    process.env['SOME_KEY'] = '';
    expect(() => requireEnv('SOME_KEY')).toThrow(/SOME_KEY/);
  });

  it('mentions the workspace-root .env in the remediation message', () => {
    delete process.env['SOME_KEY'];
    expect(() => requireEnv('SOME_KEY')).toThrow(/\.env/);
  });
});
