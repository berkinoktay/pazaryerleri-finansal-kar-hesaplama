import { describe, expect, it } from 'vitest';

import {
  assertWritableValue,
  escapeXmlText,
  isWritableText,
  needsSpacePreserve,
} from './cell-values';

// Built from code units so the source file stays ASCII.
const NON_CHARACTER_FFFE = String.fromCharCode(0xfffe);
const NON_CHARACTER_FFFF = String.fromCharCode(0xffff);
const LONE_HIGH_SURROGATE = String.fromCharCode(0xd800);
const LONE_LOW_SURROGATE = String.fromCharCode(0xdc00);

describe('assertWritableValue: number', () => {
  it.each(['0', '-0', '12.50', '1299.12', '15.4', '-3.005'])('accepts %j', (value) => {
    expect(() => assertWritableValue({ kind: 'number', value })).not.toThrow();
  });

  it.each(['1e-7', 'NaN', 'Infinity', '12,50', '01', '.5', '5.', '+1', ' 1', '', '1'.repeat(65)])(
    'rejects %j',
    (value) => {
      expect(() => assertWritableValue({ kind: 'number', value })).toThrow('Invalid patch request');
    },
  );
});

describe('assertWritableValue: number with scale', () => {
  it.each([
    ['15.40', 2],
    ['15', 0],
  ])('accepts %j with scale %i', (value, scale) => {
    expect(() => assertWritableValue({ kind: 'number', value, scale })).not.toThrow();
  });

  it.each([
    ['15.4', 2],
    ['15.0', 0],
    ['15', -1],
    ['15', 1.5],
  ])('rejects %j with scale %d', (value, scale) => {
    expect(() => assertWritableValue({ kind: 'number', value, scale })).toThrow(
      'Invalid patch request',
    );
  });
});

describe('assertWritableValue: text', () => {
  it.each(['', 'a\tb\nc', '\u{1F600}', 'x'.repeat(32_767)])('accepts text %#', (value) => {
    expect(() => assertWritableValue({ kind: 'text', value })).not.toThrow();
  });

  it.each([
    'a\rb',
    '\u0000',
    '\u000B',
    NON_CHARACTER_FFFE,
    NON_CHARACTER_FFFF,
    LONE_HIGH_SURROGATE,
    `a${LONE_LOW_SURROGATE}`,
    'x'.repeat(32_768),
  ])('rejects text %#', (value) => {
    expect(() => assertWritableValue({ kind: 'text', value })).toThrow('Invalid patch request');
  });
});

describe('assertWritableValue: clear', () => {
  it('has nothing to check', () => {
    expect(() => assertWritableValue({ kind: 'clear' })).not.toThrow();
  });
});

describe('isWritableText', () => {
  it('accepts TAB and LF, rejects CR', () => {
    expect(isWritableText('a\tb\nc')).toBe(true);
    expect(isWritableText('a\rb')).toBe(false);
  });
});

describe('escapeXmlText', () => {
  it('escapes &, < and > only', () => {
    expect(escapeXmlText('a<b&c>"d')).toBe('a&lt;b&amp;c&gt;"d');
  });
});

describe('needsSpacePreserve', () => {
  it.each([' a', 'a\n'])('is true for %j', (text) => {
    expect(needsSpacePreserve(text)).toBe(true);
  });

  it.each(['a b', ''])('is false for %j', (text) => {
    expect(needsSpacePreserve(text)).toBe(false);
  });
});
