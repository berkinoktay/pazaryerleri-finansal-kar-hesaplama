import { describe, expect, it } from 'vitest';

import { compareText } from '../compare-text';

describe('compareText', () => {
  it('orders by code unit, not by locale', () => {
    expect(compareText('a', 'b')).toBe(-1);
    expect(compareText('b', 'a')).toBe(1);
    // Upper case sorts before lower case by code unit; a locale compare would not.
    expect(compareText('Z', 'a')).toBe(-1);
  });

  it('returns 0 for equal strings', () => {
    expect(compareText('rec-1', 'rec-1')).toBe(0);
  });

  it('sorts a list into ascending order', () => {
    expect(['c', '10', 'B', '2', 'a'].sort(compareText)).toEqual(['10', '2', 'B', 'a', 'c']);
  });
});
