import { describe, expect, it } from 'vitest';

import { decodeExcelEscapes } from './excel-escape';
import { expectWithinBudget, LINEAR_BUDGET_MS } from '../tests/helpers/timing';

// Pins the decoder of Excel's `_xHHHH_` cell-text escape: `_x` (lower-case x), exactly
// four hex digits in any case, then `_`. One left-to-right pass that never rescans its
// own output; an escape of a character XML 1.0 cannot carry is kept as written.

const NUL = String.fromCodePoint(0);
const C_CEDILLA = String.fromCodePoint(0x00e7);

// A high surrogate with no low one after it, or a low one with no high one before it.
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('decodeExcelEscapes: decoded escapes', () => {
  it('returns text without an escape unchanged', () => {
    const plain = 'Tisort Pamuk 42';
    expect(decodeExcelEscapes(plain)).toBe(plain);
    expect(decodeExcelEscapes('')).toBe('');
  });

  it('decodes a line feed between two words', () => {
    expect(decodeExcelEscapes('Tisort_x000a_Pamuk')).toBe('Tisort\nPamuk');
  });

  it.each([
    ['_x0009_', '\t'],
    ['_x000D_', '\r'],
    ['_x000d_', '\r'],
    ['_x0041_', 'A'],
    ['_x00e7_', C_CEDILLA],
    ['_x00E7_', C_CEDILLA],
    ['_x00E7_x', `${C_CEDILLA}x`],
    ['_xFFFD_', String.fromCodePoint(0xfffd)],
    ['_xE000_', String.fromCodePoint(0xe000)],
    ['_xD7FF_', String.fromCodePoint(0xd7ff)],
    ['_x0020_', ' '],
  ])('decodes %j', (input, expected) => {
    expect(decodeExcelEscapes(input)).toBe(expected);
  });

  it('reads an escaped underscore before an escape-shaped tail as that tail', () => {
    expect(decodeExcelEscapes('_x005F_x0041_')).toBe('_x0041_');
    expect(decodeExcelEscapes('_x005F_')).toBe('_');
  });

  it('decodes two adjacent escapes', () => {
    expect(decodeExcelEscapes('_x0041__x0042_')).toBe('AB');
  });

  it('never lets the closing underscore of one escape open the next', () => {
    expect(decodeExcelEscapes('_x0041_x0042_')).toBe('Ax0042_');
  });

  it('decodes escapes inside a longer text', () => {
    expect(decodeExcelEscapes('AB_x005F_x0041_ and _x0043_D')).toBe('AB_x0041_ and CD');
  });

  it.each([
    ['Kupa_xD83D__xDE00_', 'Kupa\u{1F600}'],
    ['_xd83d__xde00_!', '\u{1F600}!'],
    ['_xD83D__xDE00__xD83D__xDE00_', '\u{1F600}\u{1F600}'],
  ])('decodes a surrogate pair written as two escapes in %j as one character', (input, out) => {
    expect(decodeExcelEscapes(input)).toBe(out);
  });
});

describe('decodeExcelEscapes: escapes kept as written', () => {
  it.each(['_x0000_', '_x0008_', '_x001F_', '_xD800_', '_xDFFF_', '_xFFFE_', '_xFFFF_'])(
    'keeps %j, a character XML cannot carry',
    (input) => {
      expect(decodeExcelEscapes(input)).toBe(input);
    },
  );

  it('decodes a legal escape after an illegal one', () => {
    expect(decodeExcelEscapes('_x0000__x0041_')).toBe('_x0000_A');
  });

  it('consumes all seven characters of an illegal escape', () => {
    // Advancing by one would find `_x0041_` from the closing '_' of `_x0000_`.
    expect(decodeExcelEscapes('_x0000_x0041_')).toBe('_x0000_x0041_');
  });

  it.each([
    '_x004',
    '_x0041',
    '_x00G1_',
    '_x41_',
    '_X0041_',
    'x0041_',
    'Title_x',
    '_x',
    '_x0x41_',
    '_x 041_',
    '_x+041_',
    '_x-041_',
  ])('leaves the malformed form %j unchanged', (input) => {
    expect(decodeExcelEscapes(input)).toBe(input);
  });

  it.each([
    // A low surrogate first, a high surrogate with nothing after it, two highs in a row
    // (the second has no low after it), and a high followed by plain text or a legal escape.
    '_xDE00__xD83D_',
    '_xD83D_',
    '_xD83D__xD83D_',
    '_xD83D_x',
    '_xD83D_xDE00_',
  ])('keeps the unpaired surrogates of %j as written', (input) => {
    expect(decodeExcelEscapes(input)).toBe(input);
  });

  it('keeps an unpaired high surrogate and decodes the legal escape after it', () => {
    expect(decodeExcelEscapes('_xD83D__x0041_')).toBe('_xD83D_A');
  });

  it('never writes a lone surrogate', () => {
    const inputs = ['_xD83D_', '_xDE00_', '_xDE00__xD83D_', '_xD83D__xD83D__xDE00_'];
    for (const input of inputs) {
      expect(LONE_SURROGATE_RE.test(decodeExcelEscapes(input))).toBe(false);
    }
  });

  it('never writes U+0000', () => {
    const inputs = ['_x0000_', '_x0000__x0000_', '_x0000_x0000_', 'A_x0000_B', '_x005F_x0000_'];
    for (const input of inputs) {
      expect(decodeExcelEscapes(input).includes(NUL)).toBe(false);
    }
  });
});

describe('decodeExcelEscapes: cost', () => {
  it('reads a long run of escape openers in one linear pass', () => {
    const input = '_x'.repeat(50_000);
    expect(input).toHaveLength(100_000);

    const started = performance.now();
    const decoded = decodeExcelEscapes(input);
    expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);

    expect(decoded).toBe(input);
  });

  it('decodes a long run of escapes in one linear pass', () => {
    const input = '_x0041_'.repeat(20_000);

    const started = performance.now();
    const decoded = decodeExcelEscapes(input);
    expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);

    expect(decoded).toBe('A'.repeat(20_000));
  });
});
