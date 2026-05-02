import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { formatTrMoney, parseTrMoney } from '@/components/patterns/money-input';

describe('parseTrMoney', () => {
  it('parses tr-TR numeric strings with thousand and decimal separators', () => {
    expect(parseTrMoney('1.234,50')?.toString()).toBe('1234.5');
    expect(parseTrMoney('1234,50')?.toString()).toBe('1234.5');
    expect(parseTrMoney('1234')?.toString()).toBe('1234');
    expect(parseTrMoney('0,01')?.toString()).toBe('0.01');
  });

  it('parses negative values', () => {
    expect(parseTrMoney('-12,5')?.toString()).toBe('-12.5');
    expect(parseTrMoney('-1.234')?.toString()).toBe('-1234');
  });

  it('returns null for empty / whitespace / lone separators', () => {
    expect(parseTrMoney('')).toBeNull();
    expect(parseTrMoney('   ')).toBeNull();
    expect(parseTrMoney('-')).toBeNull();
    expect(parseTrMoney(',')).toBeNull();
    expect(parseTrMoney('-,')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseTrMoney('abc')).toBeNull();
    expect(parseTrMoney('1,2,3')).toBeNull();
  });

  it('preserves precision (no float drift)', () => {
    // 0.10 + 0.20 in float would be 0.30000000000000004 — Decimal must hold exact.
    const a = parseTrMoney('0,10');
    const b = parseTrMoney('0,20');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.add(b!).toString()).toBe('0.3');
  });
});

describe('formatTrMoney', () => {
  it('formats with comma decimal separator and no thousand grouping', () => {
    expect(formatTrMoney(new Decimal('1234.5'))).toBe('1234,5');
    expect(formatTrMoney(new Decimal('1234'))).toBe('1234');
    expect(formatTrMoney(new Decimal('0.01'))).toBe('0,01');
  });

  it('formats negative values with leading minus', () => {
    expect(formatTrMoney(new Decimal('-12.5'))).toBe('-12,5');
  });

  it('respects the scale argument (max decimal places)', () => {
    // scale=2 truncates extra precision via Intl.NumberFormat rounding
    expect(formatTrMoney(new Decimal('1.999'), 2)).toBe('2');
    expect(formatTrMoney(new Decimal('1.235'), 2)).toBe('1,24');
    // scale=0 yields whole numbers only
    expect(formatTrMoney(new Decimal('1234.56'), 0)).toBe('1235');
  });

  it('round-trips with parseTrMoney for common values', () => {
    const cases = ['0', '1', '12,5', '1234', '1234,5', '0,01', '-12,5'];
    for (const original of cases) {
      const parsed = parseTrMoney(original);
      expect(parsed).not.toBeNull();
      const formatted = formatTrMoney(parsed!, 2);
      // After round-trip: re-parsing should yield the same Decimal.
      expect(parseTrMoney(formatted)?.eq(parsed!)).toBe(true);
    }
  });
});
