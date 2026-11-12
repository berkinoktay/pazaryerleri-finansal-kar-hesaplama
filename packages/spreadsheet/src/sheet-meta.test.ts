import { describe, it, expect } from 'vitest';
import { colRefToNumber } from './sheet-meta';

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
