import { describe, it, expect } from 'vitest';
import { cellKey, colRefToNumber, columnLetters } from './sheet-meta';

describe('colRefToNumber', () => {
  it.each([
    ['A', 1],
    ['Z', 26],
    ['AA', 27],
    ['AI', 35],
  ])('%s -> %i', (ref, n) => {
    expect(colRefToNumber(ref)).toBe(n);
  });
});

describe('columnLetters', () => {
  it.each([
    [1, 'A'],
    [26, 'Z'],
    [27, 'AA'],
    [256, 'IV'],
    [702, 'ZZ'],
    [703, 'AAA'],
  ])('%i -> %s', (column, letters) => {
    expect(columnLetters(column)).toBe(letters);
  });

  it('round-trips through colRefToNumber for columns 1..1000', () => {
    for (let n = 1; n <= 1000; n += 1) {
      expect(colRefToNumber(columnLetters(n))).toBe(n);
    }
  });
});

describe('cellKey', () => {
  it('packs a 1-based row and column into one number', () => {
    expect(cellKey(2, 28)).toBe(2076);
  });
});
