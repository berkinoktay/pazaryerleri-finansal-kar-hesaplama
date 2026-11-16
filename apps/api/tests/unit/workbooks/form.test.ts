import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

import { UpdateDiscountListBodySchema } from '@/validators/discount-list.validator';
import {
  DATE_OUT_OF_RANGE,
  INVALID_DATE,
  NAME_REQUIRED,
  RequiredNameSchema,
  WindowInstantSchema,
} from '@/workbooks/form';

/** The issue messages of a parse, each one a field issue code; empty when it passes. */
function issueCodes(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('RequiredNameSchema', () => {
  it('holds its issue code', () => {
    expect(NAME_REQUIRED).toBe('NAME_REQUIRED');
  });

  it.each([
    ['a whitespace-only name', '   '],
    ['an empty name', ''],
  ])('refuses %s with exactly NAME_REQUIRED', (_name, input) => {
    expect(issueCodes(RequiredNameSchema, input)).toEqual([NAME_REQUIRED]);
  });

  it('parses a padded name to its trimmed text', () => {
    expect(RequiredNameSchema.parse('  A  ')).toBe('A');
  });
});

describe('WindowInstantSchema', () => {
  it('holds its issue codes', () => {
    expect([INVALID_DATE, DATE_OUT_OF_RANGE]).toEqual(['INVALID_DATE', 'DATE_OUT_OF_RANGE']);
  });

  it.each([
    ['a 2026 window start', '2026-07-21T05:00:00.000Z'],
    ['the first instant of 1900', '1900-01-01T00:00:00Z'],
    ['the last instant of 9999', '9999-12-31T23:59:59Z'],
  ])('accepts %s', (_name, input) => {
    expect(issueCodes(WindowInstantSchema, input)).toEqual([]);
  });

  it.each([
    ['the last instant of 1899', '1899-12-31T23:59:59Z'],
    ['the year 0', '0000-01-01T00:00:00Z'],
    ['the year 50', '0050-06-01T00:00:00Z'],
    ['a 9999 local time that is the UTC year 10000', '9999-12-31T23:59:59-01:00'],
  ])('refuses %s with exactly DATE_OUT_OF_RANGE', (_name, input) => {
    expect(issueCodes(WindowInstantSchema, input)).toEqual([DATE_OUT_OF_RANGE]);
  });

  it.each([
    ['a text that is no date', 'not a date'],
    ['a date without a time', '2026-07-21'],
    ['a parseable year-0 date without a time', '0000-01-01'],
  ])('refuses %s with exactly INVALID_DATE', (_name, input) => {
    expect(issueCodes(WindowInstantSchema, input)).toEqual([INVALID_DATE]);
  });
});

describe('a malformed window date in a config body', () => {
  it('never hides the issue of another field', () => {
    const result = UpdateDiscountListBodySchema.safeParse({
      discountType: 'NET',
      valueKind: 'AMOUNT',
      startsAt: 'not a date',
      endsAt: '2026-07-28T04:59:00.000Z',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      code: issue.message,
    }));
    expect(issues.filter((issue) => issue.field === 'startsAt')).toEqual([
      { field: 'startsAt', code: INVALID_DATE },
    ]);
    expect(issues).toContainEqual({ field: 'value', code: 'VALUE_REQUIRED' });
  });
});
