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
// Null / disabled scale -> OFF state -> returns undefined
// ---------------------------------------------------------------------------

describe('marginColorStyle — scale null (OFF state)', () => {
  it('returns undefined for a positive value', () => {
    expect(marginColorStyle('100.00', null)).toBeUndefined();
  });

  it('returns undefined for a negative value', () => {
    expect(marginColorStyle('-50.00', null)).toBeUndefined();
  });

  it('returns undefined for zero', () => {
    expect(marginColorStyle('0', null)).toBeUndefined();
    expect(marginColorStyle('0.00', null)).toBeUndefined();
  });

  it('returns undefined for null value', () => {
    expect(marginColorStyle(null, null)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(marginColorStyle('', null)).toBeUndefined();
  });
});

describe('marginColorStyle — disabled scale (OFF state)', () => {
  it('returns undefined for a positive value', () => {
    expect(marginColorStyle('25.5', CLOSED_SCALE)).toBeUndefined();
  });

  it('returns undefined for a negative value', () => {
    expect(marginColorStyle('-5.0', CLOSED_SCALE)).toBeUndefined();
  });

  it('returns undefined for null with a disabled scale', () => {
    expect(marginColorStyle(null, CLOSED_SCALE)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Enabled scale -> returns { color: <bucket color> }
// ---------------------------------------------------------------------------

describe('marginColorStyle — enabled scale (threshold color)', () => {
  it('maps a value to the correct bucket color via { color }', () => {
    // 25.7% -> bucket[3] (threshold 25) -> buckets[3].color
    const result = marginColorStyle('25.7', OPEN_SCALE);
    expect(result).toEqual({ color: DEFAULT_MARGIN_BUCKETS[3]!.color });
  });

  it('maps a negative value to the first (loss) bucket', () => {
    // -50 -> bucket[0] (below first threshold -10)
    const result = marginColorStyle('-50', OPEN_SCALE);
    expect(result).toEqual({ color: DEFAULT_MARGIN_BUCKETS[0]!.color });
  });

  it('maps a high value to the last bucket', () => {
    const result = marginColorStyle('99', OPEN_SCALE);
    expect(result).toEqual({ color: DEFAULT_MARGIN_BUCKETS[4]!.color });
  });

  it('non-zero value exactly on threshold -> that bucket', () => {
    // '10' -> bucket[2] (threshold=10)
    const result = marginColorStyle('10', OPEN_SCALE);
    expect(result).toEqual({ color: DEFAULT_MARGIN_BUCKETS[2]!.color });
  });

  it('returns undefined for null value with an enabled scale', () => {
    expect(marginColorStyle(null, OPEN_SCALE)).toBeUndefined();
  });

  it('returns undefined for empty string with an enabled scale', () => {
    expect(marginColorStyle('', OPEN_SCALE)).toBeUndefined();
  });

  it('returns undefined for an unparseable string with an enabled scale', () => {
    expect(marginColorStyle('not-a-number', OPEN_SCALE)).toBeUndefined();
  });

  it('returns a plain object with only a color key (no className)', () => {
    const result = marginColorStyle('15.0', OPEN_SCALE);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual(['color']);
  });
});
