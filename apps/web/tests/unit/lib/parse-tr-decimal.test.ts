import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { formatTrMoney, parseTrMoney } from '@/components/patterns/money-input';
import { formatTrDecimal, parseTrDecimal } from '@/lib/parse-tr-decimal';

const GROUPING = { grouping: true } as const;
const NO_GROUPING = { grouping: false } as const;

// Inputs that are never a number in either mode. The hardened ones ('1e3',
// '0x10', 'Infinity', 'NaN') are accepted by `new Decimal` itself, so the
// parser must reject them before construction.
const INVALID_IN_BOTH_MODES = [
  '',
  '   ',
  '-',
  '+',
  ',',
  '.',
  '-,',
  '-.',
  'abc',
  '12a',
  '1,2,3',
  '1 5',
  '1e3',
  '1E3',
  '1,5e2',
  '0x10',
  '0b101',
  '0o17',
  'Infinity',
  '-Infinity',
  'NaN',
  '--5',
];

describe('parseTrDecimal (grouping: true, money semantics)', () => {
  it.each([
    ['1,5', '1.5'],
    ['1.234,50', '1234.5'],
    ['1.234,5', '1234.5'],
    ['1234,50', '1234.5'],
    ['1234', '1234'],
    ['0,01', '0.01'],
    ['999,99', '999.99'],
    ['1.000.000', '1000000'],
  ])('parses %s to %s', (input, expected) => {
    expect(parseTrDecimal(input, GROUPING)?.toString()).toBe(expected);
  });

  it('treats a lone dot as a thousands separator ("1.5" is 15)', () => {
    // This is exactly why desi input must NOT use grouping mode.
    expect(parseTrDecimal('1.5', GROUPING)?.toString()).toBe('15');
  });

  it('parses negative values', () => {
    expect(parseTrDecimal('-12,5', GROUPING)?.toString()).toBe('-12.5');
    expect(parseTrDecimal('-1.234', GROUPING)?.toString()).toBe('-1234');
  });

  it('trims surrounding whitespace', () => {
    expect(parseTrDecimal('  1.234,5 ', GROUPING)?.toString()).toBe('1234.5');
  });

  it('accepts in-progress buffers with a trailing or leading comma', () => {
    expect(parseTrDecimal('1,', GROUPING)?.toString()).toBe('1');
    expect(parseTrDecimal(',5', GROUPING)?.toString()).toBe('0.5');
  });

  it.each(INVALID_IN_BOTH_MODES)('returns null for %j', (input) => {
    expect(parseTrDecimal(input, GROUPING)).toBeNull();
  });

  it('preserves precision (no float drift)', () => {
    const a = parseTrDecimal('0,10', GROUPING);
    const b = parseTrDecimal('0,20', GROUPING);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.add(b!).toString()).toBe('0.3');
  });
});

describe('parseTrDecimal (grouping: false, desi semantics)', () => {
  it('reads a lone dot as the decimal separator ("1.5" is 1.5, never 15)', () => {
    expect(parseTrDecimal('1.5', NO_GROUPING)?.toString()).toBe('1.5');
  });

  it.each([
    ['1,5', '1.5'],
    ['1.5', '1.5'],
    ['999,99', '999.99'],
    ['999.99', '999.99'],
    ['3', '3'],
    ['0', '0'],
    ['0,5', '0.5'],
    ['2,50', '2.5'],
  ])('parses %s to %s', (input, expected) => {
    expect(parseTrDecimal(input, NO_GROUPING)?.toString()).toBe(expected);
  });

  it('keeps 999,99 exact', () => {
    expect(parseTrDecimal('999,99', NO_GROUPING)?.eq(new Decimal('999.99'))).toBe(true);
  });

  it.each(['1.234,5', '1,234.5', '1.2.3', '1,2,3', '1.,5'])(
    'rejects more than one separator: %j',
    (input) => {
      expect(parseTrDecimal(input, NO_GROUPING)).toBeNull();
    },
  );

  it('never reads a lone dot as grouping ("1.234" is 1.234, not 1234)', () => {
    // The caller's 2-digit scale check then rejects it instead of saving 1234.
    expect(parseTrDecimal('1.234', NO_GROUPING)?.toString()).toBe('1.234');
  });

  it.each(INVALID_IN_BOTH_MODES)('returns null for %j', (input) => {
    expect(parseTrDecimal(input, NO_GROUPING)).toBeNull();
  });

  it('passes the sign through so the caller owns the bounds check', () => {
    expect(parseTrDecimal('-1,5', NO_GROUPING)?.toString()).toBe('-1.5');
  });

  it('keeps every fraction digit so the caller can enforce the scale', () => {
    expect(parseTrDecimal('0,001', NO_GROUPING)?.decimalPlaces()).toBe(3);
  });

  it('yields a canonical dot string without an exponent via toFixed()', () => {
    expect(parseTrDecimal('0,0000001', NO_GROUPING)?.toFixed()).toBe('0.0000001');
    expect(parseTrDecimal('2,5', NO_GROUPING)?.toFixed()).toBe('2.5');
  });
});

describe('parseTrMoney delegates to parseTrDecimal in grouping mode', () => {
  it.each(['1.234,50', '1.5', '-12,5', '1,', ...INVALID_IN_BOTH_MODES])(
    'agrees for %j',
    (input) => {
      const viaMoney = parseTrMoney(input);
      const viaShared = parseTrDecimal(input, GROUPING);
      if (viaShared === null) {
        expect(viaMoney).toBeNull();
        return;
      }
      expect(viaMoney?.eq(viaShared)).toBe(true);
    },
  );
});

describe('formatTrDecimal', () => {
  it.each([
    ['1.50', '1,5'],
    ['1.5', '1,5'],
    ['3', '3'],
    ['3.00', '3'],
    ['0', '0'],
    ['999.99', '999,99'],
    ['1234.5', '1234,5'],
    ['-12.5', '-12,5'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatTrDecimal(input)).toBe(expected);
  });

  it('accepts a Decimal', () => {
    expect(formatTrDecimal(new Decimal('2.5'))).toBe('2,5');
  });

  it('prints at most two fraction digits (half-up rounding)', () => {
    expect(formatTrDecimal('1.235')).toBe('1,24');
    expect(formatTrDecimal('1.999')).toBe('2');
    expect(formatTrDecimal('0.001')).toBe('0');
  });

  it('never prints thousands grouping or an exponent', () => {
    expect(formatTrDecimal('1234567.5')).toBe('1234567,5');
    expect(formatTrDecimal(new Decimal('12345678901234567890'))).toBe('12345678901234567890');
    expect(formatTrDecimal(new Decimal('1e-7'))).toBe('0');
  });

  it('honours an explicit max fraction digits (used by formatTrMoney)', () => {
    expect(formatTrDecimal('1234.56', 0)).toBe('1235');
    expect(formatTrMoney(new Decimal('1234.56'), 0)).toBe('1235');
  });

  it('round-trips with parseTrDecimal in desi mode', () => {
    for (const original of ['0', '1.5', '2.5', '12', '999.99']) {
      const formatted = formatTrDecimal(original);
      expect(parseTrDecimal(formatted, NO_GROUPING)?.eq(new Decimal(original))).toBe(true);
    }
  });
});
