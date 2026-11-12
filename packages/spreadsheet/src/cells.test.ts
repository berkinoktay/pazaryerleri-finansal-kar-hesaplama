import { describe, expect, it, vi } from 'vitest';

import {
  cellDecimal,
  cellFlag,
  cellInstant,
  cellInt,
  cellNumericFlag,
  cellText,
  cellWallClock,
  findHeader,
  formatPlainDecimal,
  normalizeHeader,
  type ColumnIndex,
  type FlagRule,
  type WallClockPattern,
} from './cells';

// Pins the cell readers that moved here from apps/api/src/lib/xlsx-grid-cells.ts. The
// string grammars keep every quirk of the old readers on purpose; only the number path
// changed: plain notation instead of exponent form, and non-finite values read as absent.

const WALL_CLOCK: WallClockPattern = 'dd/MM/yyyy HH:mm';

describe('cellDecimal, currency grammar (ported from xlsx-grid-cells.test.ts)', () => {
  it('strips the lira sign suffix', () => {
    expect(cellDecimal(['250 ₺'], 0, 'currency')).toBe('250');
  });
  it('resolves Turkish thousands+decimal separators with currency noise', () => {
    expect(cellDecimal(['1.234,56 ₺'], 0, 'currency')).toBe('1234.56');
  });
  it('reads Turkish dot-only thousands as an integer (no comma decimal)', () => {
    expect(cellDecimal(['1.250 ₺'], 0, 'currency')).toBe('1250');
    expect(cellDecimal(['1.250.000 ₺'], 0, 'currency')).toBe('1250000');
  });
  it('keeps a 2-digit tail as a decimal, not thousands', () => {
    expect(cellDecimal(['1.25'], 0, 'currency')).toBe('1.25');
  });
  it('passes plain numbers through', () => {
    expect(cellDecimal([250], 0, 'currency')).toBe('250');
  });
  it('returns null for empty and non-numeric cells', () => {
    expect(cellDecimal([''], 0, 'currency')).toBeNull();
    expect(cellDecimal(['Kaybeden'], 0, 'currency')).toBeNull();
    expect(cellDecimal([], 0, 'currency')).toBeNull();
  });
});

describe('string grammar quirks kept from the old readers', () => {
  it.each<[string, string | null]>([
    ['1.250', '1.250'],
    ['1,234.56', '1.23456'],
    ['₺250', null],
    ['%18', null],
    ['+12', null],
    ['1e3', null],
    ['.5', null],
    ['5.', null],
    ['1.2.3', null],
    ['1,2,3', null],
    ['−5', null],
  ])('plain %j -> %j', (input, expected) => {
    expect(cellDecimal([input], 0, 'plain')).toBe(expected);
  });

  it.each<[string, string | null]>([
    ['1.250', '1250'],
    ['-1.250', '-1.250'],
    ['250 tl', '250'],
    ['TL 250', null],
    ['12 34', '1234'],
    ['$1,000.00', '1.00000'],
  ])('currency %j -> %j', (input, expected) => {
    expect(cellDecimal([input], 0, 'currency')).toBe(expected);
  });

  it('truncate keeps the sign of a negative fraction', () => {
    expect(cellInt(['-0.5'], 0, 'truncate')).toBe(-0);
  });

  it('truncate reads through the plain grammar', () => {
    expect(cellInt(['1.250'], 0, 'truncate')).toBe(1);
    expect(cellInt(['1.234,5'], 0, 'truncate')).toBe(1234);
  });

  it.each<[unknown, number | null]>([
    ['007', 7],
    ['1.000', null],
    [100.5, null],
    ['-1', null],
    [1e21, null],
    [100, 100],
  ])('strict %j -> %j', (input, expected) => {
    expect(cellInt([input], 0, 'strict')).toBe(expected);
  });

  it('text keeps String(n) for numbers', () => {
    expect(cellText([1e21], 0)).toBe('1e+21');
    expect(cellText([-0], 0)).toBe('0');
    expect(cellText(['  abc  '], 0)).toBe('abc');
    expect(cellText([true], 0)).toBeNull();
    expect(cellText([new Date(0)], 0)).toBeNull();
  });
});

describe('number cells', () => {
  // 2.8421709430404007e-14 is 2^-45, whose shortest form String(n) gives is
  // "2.842170943040401e-14"; decimal.js `new Decimal(n).toFixed()` writes the same 16 digits.
  it('writes a float residue in plain notation', () => {
    expect(cellDecimal([2.8421709430404007e-14], 0, 'plain')).toBe(
      '0.00000000000002842170943040401',
    );
    expect(cellDecimal([2.8421709430404007e-14], 0, 'currency')).toBe(
      '0.00000000000002842170943040401',
    );
  });

  it('reads Infinity as absent', () => {
    expect(cellDecimal([Infinity], 0, 'plain')).toBeNull();
    expect(cellDecimal([-Infinity], 0, 'currency')).toBeNull();
    expect(cellInt([Infinity], 0, 'truncate')).toBeNull();
    expect(cellNumericFlag([Infinity], 0)).toBe(false);
  });
});

describe('formatPlainDecimal', () => {
  it.each<[number, string]>([
    [1e21, '1000000000000000000000'],
    [1e-7, '0.0000001'],
    [-0, '0'],
    [875, '875'],
    [93.40000000000002, '93.40000000000002'],
    [0.1 + 0.2, '0.30000000000000004'],
    [-1e-7, '-0.0000001'],
    [-1.5e22, '-15000000000000000000000'],
    [Number.MIN_VALUE, `0.${'0'.repeat(323)}5`],
  ])('%s -> %s', (input, expected) => {
    expect(formatPlainDecimal(input)).toBe(expected);
  });

  it('returns null for non-finite values', () => {
    expect(formatPlainDecimal(Infinity)).toBeNull();
    expect(formatPlainDecimal(-Infinity)).toBeNull();
    expect(formatPlainDecimal(Number.NaN)).toBeNull();
  });

  it('round-trips seeded random doubles and matches String(n) inside [1e-6, 1e21)', () => {
    const next = seededRandom(0x5eed);
    const bits = new DataView(new ArrayBuffer(8));
    const samples: number[] = [];
    while (samples.length < 4000) {
      bits.setUint32(0, next());
      bits.setUint32(4, next());
      const fromBits = bits.getFloat64(0);
      if (Number.isFinite(fromBits)) samples.push(fromBits);
      const exponent = (next() % 61) - 30;
      samples.push((next() / 0x1_0000_0000) * 10 ** exponent);
    }
    for (const value of samples) {
      const plain = formatPlainDecimal(value);
      expect(plain).not.toBeNull();
      expect(plain).not.toMatch(/e/i);
      expect(Number(plain)).toBe(value === 0 ? 0 : value);
      const magnitude = Math.abs(value);
      if (magnitude >= 1e-6 && magnitude < 1e21) expect(plain).toBe(String(value));
    }
  });
});

describe('cellFlag and cellNumericFlag', () => {
  const VAR_CASEFOLD: FlagRule = { yes: 'var', compare: 'casefold-tr' };
  const EVET_EXACT: FlagRule = { yes: 'Evet', compare: 'exact' };

  it('casefold-tr folds the cell text', () => {
    expect(cellFlag(['VAR'], 0, VAR_CASEFOLD)).toBe(true);
    expect(cellFlag([' var '], 0, VAR_CASEFOLD)).toBe(true);
    expect(cellFlag(['Yok'], 0, VAR_CASEFOLD)).toBe(false);
  });

  it('casefold-tr folds the rule too, with Turkish dotted and dotless i', () => {
    expect(cellFlag(['var'], 0, { yes: 'VAR', compare: 'casefold-tr' })).toBe(true);
    expect(cellFlag(['BİLGİ'], 0, { yes: 'bilgi', compare: 'casefold-tr' })).toBe(true);
    expect(cellFlag(['BILGI'], 0, { yes: 'bilgi', compare: 'casefold-tr' })).toBe(false);
  });

  it('exact compares the trimmed text as is', () => {
    expect(cellFlag(['Evet'], 0, EVET_EXACT)).toBe(true);
    expect(cellFlag(['evet'], 0, EVET_EXACT)).toBe(false);
  });

  it('numeric flag is a non-zero truncated integer', () => {
    expect(cellNumericFlag([1], 0)).toBe(true);
    expect(cellNumericFlag(['2'], 0)).toBe(true);
    expect(cellNumericFlag([0], 0)).toBe(false);
    expect(cellNumericFlag(['0,9'], 0)).toBe(false);
    expect(cellNumericFlag([true], 0)).toBe(false);
  });
});

describe('cellWallClock and cellInstant', () => {
  it('reads "dd/MM/yyyy HH:mm" text as the wall clock in UTC milliseconds', () => {
    expect(cellWallClock(['05/11/2026 14:30'], 0, WALL_CLOCK)).toBe(Date.UTC(2026, 10, 5, 14, 30));
  });

  it('reads a Date cell as its getTime()', () => {
    const naive = new Date(Date.UTC(2026, 6, 8, 0, 0));
    expect(cellWallClock([naive], 0, WALL_CLOCK)).toBe(naive.getTime());
  });

  it('reads an Invalid Date cell as null', () => {
    expect(cellWallClock([new Date(Number.NaN)], 0, WALL_CLOCK)).toBeNull();
  });

  it('rolls an out-of-range day or time over without a range check, as today', () => {
    expect(cellWallClock(['31/02/2026 25:99'], 0, WALL_CLOCK)).toBe(Date.UTC(2026, 2, 4, 2, 39));
  });

  it('reads other shapes as null', () => {
    expect(cellWallClock(['05/11/2026 14:30:00'], 0, WALL_CLOCK)).toBeNull();
    expect(cellWallClock(['2026-11-05 14:30'], 0, WALL_CLOCK)).toBeNull();
    expect(cellWallClock([46000], 0, WALL_CLOCK)).toBeNull();
    expect(cellWallClock([null], 0, WALL_CLOCK)).toBeNull();
  });

  it('cellInstant applies the injected toInstant to the wall clock', () => {
    const threeHoursMs = 3 * 60 * 60 * 1000;
    const instant = cellInstant(
      ['05/11/2026 14:30'],
      0,
      WALL_CLOCK,
      (wallClockMs) => new Date(wallClockMs - threeHoursMs),
    );
    expect(instant?.toISOString()).toBe('2026-11-05T11:30:00.000Z');
  });

  it('cellInstant skips toInstant when the cell is absent or invalid', () => {
    const toInstant = vi.fn((wallClockMs: number) => new Date(wallClockMs));
    expect(cellInstant([null], 0, WALL_CLOCK, toInstant)).toBeNull();
    expect(cellInstant([new Date(Number.NaN)], 0, WALL_CLOCK, toInstant)).toBeNull();
    expect(toInstant).not.toHaveBeenCalled();
  });
});

describe.each<[string, ColumnIndex]>([
  ['-1', -1],
  ['null', null],
])('absent column (%s)', (_label, idx) => {
  // Each row holds a readable value at its last index, so a reader that resolved the
  // index with `row.at(idx)` would read it instead of treating the column as absent.
  const readable = ['1'];
  const wallClock = ['05/11/2026 14:30'];
  const rule: FlagRule = { yes: '1', compare: 'exact' };

  it('reads null or false in every reader', () => {
    expect(cellText(readable, idx)).toBeNull();
    expect(cellDecimal(readable, idx, 'plain')).toBeNull();
    expect(cellDecimal(readable, idx, 'currency')).toBeNull();
    expect(cellInt(readable, idx, 'truncate')).toBeNull();
    expect(cellInt(readable, idx, 'strict')).toBeNull();
    expect(cellFlag(readable, idx, rule)).toBe(false);
    expect(cellFlag(readable, idx, { yes: '1', compare: 'casefold-tr' })).toBe(false);
    expect(cellNumericFlag(readable, idx)).toBe(false);
    expect(cellWallClock(wallClock, idx, WALL_CLOCK)).toBeNull();
    expect(cellInstant(wallClock, idx, WALL_CLOCK, (ms) => new Date(ms))).toBeNull();
  });
});

describe('normalizeHeader and findHeader', () => {
  it('normalizes to NFC, trims and collapses whitespace', () => {
    expect(normalizeHeader('  Model   Kodu ')).toBe('Model Kodu');
    expect(normalizeHeader('Café')).toBe('Café');
    expect(normalizeHeader(null)).toBe('');
    expect(normalizeHeader(undefined)).toBe('');
  });

  it('finds the first normalized match, or -1', () => {
    const headers = ['Barkod', 'Model Kodu', 'Barkod'];
    expect(findHeader(headers, ' Model  Kodu ')).toBe(1);
    expect(findHeader(headers, 'Barkod')).toBe(0);
    expect(findHeader(headers, 'Stok')).toBe(-1);
  });
});

/** Deterministic 32-bit generator (mulberry32), so the sample set never changes between runs. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
