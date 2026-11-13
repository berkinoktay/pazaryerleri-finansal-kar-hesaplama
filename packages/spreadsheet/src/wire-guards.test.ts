import { describe, expect, it } from 'vitest';

import { isPositiveInteger, isRecord } from './wire-guards';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
  });

  it.each([null, [], 'x'])('rejects %j', (value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe('isPositiveInteger', () => {
  it('accepts 1', () => {
    expect(isPositiveInteger(1)).toBe(true);
  });

  it.each([0, 1.5, Number.NaN, '1'])('rejects %j', (value) => {
    expect(isPositiveInteger(value)).toBe(false);
  });
});
