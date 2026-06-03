import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

import { csvParam, decimalBoundParam, flagParam, intBoundParam } from '@/lib/query-params';

describe('csvParam', () => {
  const enumParam = csvParam(z.enum(['A', 'B', 'C']), { description: 'd', example: 'A,B' });

  it('splits, trims, and validates a comma-separated enum list', () => {
    expect(enumParam.parse('A, B ,C')).toEqual(['A', 'B', 'C']);
  });

  it('drops blank entries but keeps real ones', () => {
    expect(enumParam.parse('A,,B,')).toEqual(['A', 'B']);
  });

  it('passes through undefined (omitted param)', () => {
    expect(enumParam.parse(undefined)).toBeUndefined();
  });

  it('rejects an all-blank value rather than matching nothing', () => {
    expect(enumParam.safeParse('').success).toBe(false);
    expect(enumParam.safeParse(' , ').success).toBe(false);
  });

  it('rejects a value not in the enum', () => {
    expect(enumParam.safeParse('A,X').success).toBe(false);
  });

  it('coerces BigInt items (brand/category ids)', () => {
    const bigParam = csvParam(z.coerce.bigint(), { description: 'd', example: '1,2' });
    expect(bigParam.parse('2032,1001')).toEqual([2032n, 1001n]);
  });

  it('coerces int items (vat rates)', () => {
    const intParam = csvParam(z.coerce.number().int(), { description: 'd', example: '10,20' });
    expect(intParam.parse('10,20')).toEqual([10, 20]);
  });
});

describe('decimalBoundParam', () => {
  const positive = decimalBoundParam({ description: 'd', example: '10.00' });
  const signed = decimalBoundParam({ description: 'd', example: '-5.00' }, { allowNegative: true });

  it('accepts a 2-dp decimal string', () => {
    expect(positive.parse('149.90')).toBe('149.90');
  });

  it('rejects a negative bound unless allowNegative is set', () => {
    expect(positive.safeParse('-5.00').success).toBe(false);
    expect(signed.safeParse('-5.00').success).toBe(true);
  });

  it('rejects a non-decimal string', () => {
    expect(positive.safeParse('abc').success).toBe(false);
    expect(positive.safeParse('1.234').success).toBe(false);
  });

  it('passes through undefined', () => {
    expect(positive.parse(undefined)).toBeUndefined();
  });
});

describe('intBoundParam', () => {
  const param = intBoundParam({ description: 'd', example: 1 });

  it('coerces a numeric string to an int', () => {
    expect(param.parse('42')).toBe(42);
  });

  it('rejects negatives and non-integers', () => {
    expect(param.safeParse('-1').success).toBe(false);
    expect(param.safeParse('2.5').success).toBe(false);
  });
});

describe('flagParam', () => {
  const param = flagParam({ description: 'd' });

  it('maps the string "true"/"false" to a boolean', () => {
    expect(param.parse('true')).toBe(true);
    expect(param.parse('false')).toBe(false);
  });

  it('rejects anything else', () => {
    expect(param.safeParse('yes').success).toBe(false);
  });

  it('passes through undefined', () => {
    expect(param.parse(undefined)).toBeUndefined();
  });
});
