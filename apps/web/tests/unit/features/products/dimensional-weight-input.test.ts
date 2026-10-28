import { describe, expect, it } from 'vitest';

import { parseDesiInput } from '@/features/products/lib/dimensional-weight-input';

// parseDesiInput turns what a seller types into either "empty", a request
// payload the backend accepts (a canonical dot string), or the error code the
// backend would answer with. Turkish comma and plain dot input both mean a
// decimal separator, because desi never needs thousands grouping.

describe('parseDesiInput', () => {
  it.each(['', '   '])('reports %j as empty', (raw) => {
    expect(parseDesiInput(raw)).toEqual({ kind: 'empty' });
  });

  it.each([
    ['1,5', '1.5'],
    ['1.5', '1.5'],
    ['1,50', '1.5'],
    [' 2,25 ', '2.25'],
    ['12', '12'],
    ['0', '0'],
    ['0,00', '0'],
    ['-0', '0'],
    ['999,99', '999.99'],
    [',5', '0.5'],
  ])('accepts %j and sends %j', (raw, payload) => {
    const result = parseDesiInput(raw);
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') return;
    expect(result.payload).toBe(payload);
    expect(result.value.toFixed()).toBe(payload);
  });

  it('never sends exponent notation for a tiny value', () => {
    // 0,0000001 has more than 2 fraction digits, so it is a format error and
    // the backend regex never sees "1e-7".
    expect(parseDesiInput('0,0000001')).toEqual({
      kind: 'invalid',
      code: 'INVALID_DIMENSIONAL_WEIGHT_FORMAT',
    });
  });

  it.each(['abc', '1.234,5', '1,2,3', '1e3', '0x10', 'Infinity', '1,555', '999,991', '-'])(
    'rejects %j with the FORMAT error',
    (raw) => {
      expect(parseDesiInput(raw)).toEqual({
        kind: 'invalid',
        code: 'INVALID_DIMENSIONAL_WEIGHT_FORMAT',
      });
    },
  );

  // Trailing zeros still count: "1.500" may mean 1500 to a Turkish reader, so
  // it must not be saved silently as 1.5.
  it.each(['1.500', '1,000', '2,500', '0,000'])(
    'rejects %j with 3 typed fraction digits even when they are zeros',
    (raw) => {
      expect(parseDesiInput(raw)).toEqual({
        kind: 'invalid',
        code: 'INVALID_DIMENSIONAL_WEIGHT_FORMAT',
      });
    },
  );

  it('rejects a negative value with the TOO_SMALL error (0 itself is valid)', () => {
    expect(parseDesiInput('-1')).toEqual({
      kind: 'invalid',
      code: 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL',
    });
  });

  it.each(['1000', '1000,5'])('rejects %j above 999,99 with the TOO_LARGE error', (raw) => {
    expect(parseDesiInput(raw)).toEqual({
      kind: 'invalid',
      code: 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE',
    });
  });
});
