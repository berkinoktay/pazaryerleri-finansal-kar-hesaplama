import { describe, expect, it } from 'vitest';

import { DEFAULT_MARGIN_BUCKETS, type MarginScale } from '@/lib/margin-coloring';
import { marginBadgeStyle, marginColorStyle } from '@/lib/margin-color-style';

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

// ---------------------------------------------------------------------------
// marginBadgeStyle — the estimated-profit BADGE fill. Unlike marginColorStyle,
// it ALWAYS produces a color (a tinted fill + matching text + border) so the
// badge is never colorless: the user's scale when enabled, otherwise the
// built-in red→green default ramp. It only bows out when the margin itself is
// missing (→ neutral badge handled by the caller).
// ---------------------------------------------------------------------------

const CUSTOM_OPEN_SCALE: MarginScale = {
  enabled: true,
  buckets: [
    { threshold: 0, color: 'rgb(200, 50, 50)' },
    { threshold: 20, color: 'rgb(50, 180, 50)' },
  ],
};

const CUSTOM_CLOSED_SCALE: MarginScale = {
  enabled: false,
  buckets: [
    { threshold: 0, color: 'rgb(1, 2, 3)' },
    { threshold: 20, color: 'rgb(4, 5, 6)' },
  ],
};

describe('marginBadgeStyle — no usable margin (neutral badge)', () => {
  it('returns undefined for a null margin', () => {
    expect(marginBadgeStyle(null, null)).toBeUndefined();
    expect(marginBadgeStyle(null, CUSTOM_OPEN_SCALE)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(marginBadgeStyle('', null)).toBeUndefined();
  });

  it('returns undefined for an unparseable margin', () => {
    expect(marginBadgeStyle('not-a-number', CUSTOM_OPEN_SCALE)).toBeUndefined();
  });
});

describe('marginBadgeStyle — always colors from a red→green scale', () => {
  it('colors from the DEFAULT ramp when no scale is configured (scale null)', () => {
    // High margin → last (profit) bucket of the default ramp.
    expect(marginBadgeStyle('60', null)?.color).toBe(DEFAULT_MARGIN_BUCKETS[4]!.color);
    // Loss margin → first (loss) bucket of the default ramp.
    expect(marginBadgeStyle('-20', null)?.color).toBe(DEFAULT_MARGIN_BUCKETS[0]!.color);
  });

  it('colors from the DEFAULT ramp even when the user scale is DISABLED', () => {
    // enabled:false → ignore the custom buckets, fall back to the default ramp.
    const result = marginBadgeStyle('50', CUSTOM_CLOSED_SCALE);
    expect(result?.color).toBe(DEFAULT_MARGIN_BUCKETS[4]!.color);
    expect(result?.color).not.toBe('rgb(4, 5, 6)');
  });

  it("uses the user's custom buckets when the scale is ENABLED", () => {
    // 15.5% → >= 0 but < 20 → bucket[0] of the custom scale.
    expect(marginBadgeStyle('15.5', CUSTOM_OPEN_SCALE)?.color).toBe('rgb(200, 50, 50)');
    // 25% → >= 20 → bucket[1].
    expect(marginBadgeStyle('25', CUSTOM_OPEN_SCALE)?.color).toBe('rgb(50, 180, 50)');
  });
});

describe('marginBadgeStyle — tinted fill derived from the resolved color', () => {
  it('returns text color + a tinted backgroundColor + a tinted borderColor', () => {
    const result = marginBadgeStyle('15.5', CUSTOM_OPEN_SCALE);
    expect(result).toBeDefined();
    expect(Object.keys(result!).sort()).toEqual(['backgroundColor', 'borderColor', 'color']);
  });

  it('mixes the resolved color toward transparent for both fill and border', () => {
    const result = marginBadgeStyle('15.5', CUSTOM_OPEN_SCALE)!;
    // Both the fill and the border are a translucent tint of the SAME text color.
    expect(result.backgroundColor).toContain(result.color as string);
    expect(result.backgroundColor).toMatch(/^color-mix\(in oklab, .+ \d+%, transparent\)$/);
    expect(result.borderColor).toContain(result.color as string);
    expect(result.borderColor).toMatch(/^color-mix\(in oklab, .+ \d+%, transparent\)$/);
  });
});
