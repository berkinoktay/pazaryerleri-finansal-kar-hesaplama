import { describe, expect, it } from 'vitest';

import { DEFAULT_MARGIN_BUCKETS, type MarginScale } from '@/lib/margin-coloring';
import { marginColorStyle } from '@/lib/margin-color-style';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPEN_SCALE: MarginScale = {
  enabled: true,
  buckets: Array.from(DEFAULT_MARGIN_BUCKETS),
};

const CLOSED_SCALE: MarginScale = {
  enabled: false,
  buckets: Array.from(DEFAULT_MARGIN_BUCKETS),
};

// ---------------------------------------------------------------------------
// Null / disabled scale -> binary className fallback
// ---------------------------------------------------------------------------

describe('marginColorStyle — scale null (binary fallback)', () => {
  it('positive value -> text-success class', () => {
    const result = marginColorStyle('100.00', null);
    expect(result).toEqual({ className: 'text-success' });
  });

  it('negative value -> text-destructive class', () => {
    const result = marginColorStyle('-50.00', null);
    expect(result).toEqual({ className: 'text-destructive' });
  });

  it('zero value -> empty object', () => {
    expect(marginColorStyle('0', null)).toEqual({});
    expect(marginColorStyle('0.00', null)).toEqual({});
  });

  it('null value -> empty object', () => {
    expect(marginColorStyle(null, null)).toEqual({});
  });

  it('empty string value -> empty object', () => {
    expect(marginColorStyle('', null)).toEqual({});
  });
});

describe('marginColorStyle — disabled scale (binary fallback)', () => {
  it('positive value -> text-success class', () => {
    expect(marginColorStyle('25.5', CLOSED_SCALE)).toEqual({ className: 'text-success' });
  });

  it('negative value -> text-destructive class', () => {
    expect(marginColorStyle('-5.0', CLOSED_SCALE)).toEqual({ className: 'text-destructive' });
  });

  it('null with disabled scale -> empty object', () => {
    expect(marginColorStyle(null, CLOSED_SCALE)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Enabled scale -> threshold-mapped color style
// ---------------------------------------------------------------------------

describe('marginColorStyle — enabled scale (threshold color)', () => {
  it('maps a value to the correct bucket color via style.color', () => {
    // 25.7% -> bucket[3] (threshold 25) -> buckets[3].color
    const result = marginColorStyle('25.7', OPEN_SCALE);
    expect(result).toHaveProperty('style');
    expect(result.style).toHaveProperty('color', DEFAULT_MARGIN_BUCKETS[3]!.color);
    expect(result.className).toBeUndefined();
  });

  it('maps a negative value to the first (loss) bucket', () => {
    // -50 -> bucket[0] (below first threshold -10)
    const result = marginColorStyle('-50', OPEN_SCALE);
    expect(result.style?.color).toBe(DEFAULT_MARGIN_BUCKETS[0]!.color);
  });

  it('maps a high value to the last bucket', () => {
    const result = marginColorStyle('99', OPEN_SCALE);
    expect(result.style?.color).toBe(DEFAULT_MARGIN_BUCKETS[4]!.color);
  });

  it('maps exactly-on-threshold to that bucket (lower-bound inclusive)', () => {
    // 0 -> bucket[1] (threshold=0)
    const result = marginColorStyle('0.00', OPEN_SCALE);
    // '0.00' is neutral zero -> empty (not a threshold hit; zero neutral rule)
    expect(result).toEqual({});
  });

  it('non-zero value exactly on threshold -> that bucket', () => {
    // '10' -> bucket[2] (threshold=10)
    const result = marginColorStyle('10', OPEN_SCALE);
    expect(result.style?.color).toBe(DEFAULT_MARGIN_BUCKETS[2]!.color);
  });

  it('null value with enabled scale -> empty object', () => {
    expect(marginColorStyle(null, OPEN_SCALE)).toEqual({});
  });

  it('empty string with enabled scale -> empty object', () => {
    expect(marginColorStyle('', OPEN_SCALE)).toEqual({});
  });

  it('un-parseable string with enabled scale -> empty object', () => {
    expect(marginColorStyle('not-a-number', OPEN_SCALE)).toEqual({});
  });
});
