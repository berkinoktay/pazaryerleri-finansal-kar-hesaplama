import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { enumInWhere, rangeWhere } from '@/lib/where-builders';

describe('rangeWhere', () => {
  it('returns { gte, lte } when both bounds are present', () => {
    expect(rangeWhere(10, 50)).toEqual({ gte: 10, lte: 50 });
  });

  it('returns { gte } only when just the min is present (gte / ≥ operator)', () => {
    expect(rangeWhere(10, undefined)).toEqual({ gte: 10 });
  });

  it('returns { lte } only when just the max is present (lte / ≤ operator)', () => {
    expect(rangeWhere(undefined, 50)).toEqual({ lte: 50 });
  });

  it('returns undefined when both bounds are absent (omitted filter)', () => {
    expect(rangeWhere(undefined, undefined)).toBeUndefined();
  });

  it('supports an eq filter via min === max', () => {
    expect(rangeWhere(20, 20)).toEqual({ gte: 20, lte: 20 });
  });

  it('carries Decimal bounds through unchanged (money/percent)', () => {
    const lo = new Decimal('-5.00');
    const hi = new Decimal('149.90');
    expect(rangeWhere(lo, hi)).toEqual({ gte: lo, lte: hi });
  });

  it('carries Date bounds through unchanged (date ranges)', () => {
    const from = new Date('2026-04-01T00:00:00.000Z');
    const to = new Date('2026-05-01T00:00:00.000Z');
    expect(rangeWhere(from, to)).toEqual({ gte: from, lte: to });
  });
});

describe('enumInWhere', () => {
  it('returns { in: [...] } for a non-empty list', () => {
    expect(enumInWhere(['DELIVERED', 'SHIPPED'])).toEqual({ in: ['DELIVERED', 'SHIPPED'] });
  });

  it('copies the input array (no shared mutable reference)', () => {
    const input = ['DELIVERED'] as const;
    const result = enumInWhere(input);
    expect(result?.in).not.toBe(input);
    expect(result?.in).toEqual(['DELIVERED']);
  });

  it('returns undefined for an empty list (an omitted filter, not match-nothing)', () => {
    expect(enumInWhere([])).toBeUndefined();
  });

  it('returns undefined when the list is absent', () => {
    expect(enumInWhere(undefined)).toBeUndefined();
  });
});
