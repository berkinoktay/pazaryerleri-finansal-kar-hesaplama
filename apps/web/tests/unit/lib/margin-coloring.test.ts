import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  bucketColorFor,
  DEFAULT_MARGIN_BUCKETS,
  PRESET_KEYS,
  PRESET_RAMPS,
  sampleRamp,
  SWATCH_PALETTE,
  type MarginBucket,
  type MarginScale,
} from '@/lib/margin-coloring';

describe('SWATCH_PALETTE', () => {
  it('has at least 14 entries', () => {
    expect(SWATCH_PALETTE.length).toBeGreaterThanOrEqual(14);
  });

  it('every entry is a non-empty string', () => {
    for (const color of SWATCH_PALETTE) {
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_MARGIN_BUCKETS', () => {
  it('has exactly 5 buckets', () => {
    expect(DEFAULT_MARGIN_BUCKETS.length).toBe(5);
  });

  it('thresholds are strictly ascending', () => {
    for (let i = 1; i < DEFAULT_MARGIN_BUCKETS.length; i++) {
      expect(DEFAULT_MARGIN_BUCKETS[i]!.threshold).toBeGreaterThan(
        DEFAULT_MARGIN_BUCKETS[i - 1]!.threshold,
      );
    }
  });

  it('every bucket has a non-empty color', () => {
    for (const bucket of DEFAULT_MARGIN_BUCKETS) {
      expect(typeof bucket.color).toBe('string');
      expect(bucket.color.length).toBeGreaterThan(0);
    }
  });
});

describe('presets', () => {
  it('PRESET_RAMPS has a non-empty ramp for every PRESET_KEYS entry', () => {
    for (const key of PRESET_KEYS) {
      expect(PRESET_RAMPS[key].length).toBeGreaterThanOrEqual(2);
    }
  });

  it('sampleRamp returns the requested number of stops', () => {
    const ramp = PRESET_RAMPS.redGreen;
    expect(sampleRamp(ramp, 3)).toHaveLength(3);
    expect(sampleRamp(ramp, ramp.length)).toEqual([...ramp]);
    expect(sampleRamp(ramp, ramp.length + 2)).toHaveLength(ramp.length + 2);
  });

  it('applyPreset preserves thresholds and recolors from the ramp', () => {
    const recolored = applyPreset(DEFAULT_MARGIN_BUCKETS, 'colorblind');
    expect(recolored).toHaveLength(DEFAULT_MARGIN_BUCKETS.length);
    recolored.forEach((b, i) => {
      expect(b.threshold).toBe(DEFAULT_MARGIN_BUCKETS[i]!.threshold);
      expect(b.color.length).toBeGreaterThan(0);
    });
  });
});

describe('bucketColorFor', () => {
  const b: readonly MarginBucket[] = DEFAULT_MARGIN_BUCKETS;
  // thresholds: [-10, 0, 10, 25, 50]
  // bucket[0]: ..and below -10 (exclusive: anything < 0 threshold, i.e. < -10 goes here too)
  // Actually: first bucket covers anything below threshold[1]=0, i.e. < 0
  // Let's verify: bucket[i] covers [threshold_i, threshold_{i+1})
  // bucket[0]: threshold=-10, covers [-10, 0)  + anything below -10 (it's the first bucket)
  // bucket[1]: threshold=0,   covers [0, 10)
  // bucket[2]: threshold=10,  covers [10, 25)
  // bucket[3]: threshold=25,  covers [25, 50)
  // bucket[4]: threshold=50,  covers [50, ...] (last bucket, no upper bound)

  it('below-lowest threshold returns the first bucket color', () => {
    // -50 < -10 (first threshold) -> first bucket
    expect(bucketColorFor(-50, b)).toBe(b[0]!.color);
    // -100 also first bucket
    expect(bucketColorFor(-100, b)).toBe(b[0]!.color);
  });

  it('exactly on first threshold returns the first bucket color', () => {
    // -10 >= -10 (first bucket lower-bound), < 0 -> first bucket
    expect(bucketColorFor(-10, b)).toBe(b[0]!.color);
  });

  it('exactly on a middle threshold returns that bucket color', () => {
    // 0 >= 0, < 10 -> bucket[1]
    expect(bucketColorFor(0, b)).toBe(b[1]!.color);
    // 10 >= 10, < 25 -> bucket[2]
    expect(bucketColorFor(10, b)).toBe(b[2]!.color);
    // 25 >= 25, < 50 -> bucket[3]
    expect(bucketColorFor(25, b)).toBe(b[3]!.color);
  });

  it('exactly on the last threshold returns the last bucket color', () => {
    expect(bucketColorFor(50, b)).toBe(b[4]!.color);
  });

  it('above-highest threshold returns the last bucket color', () => {
    expect(bucketColorFor(100, b)).toBe(b[4]!.color);
    expect(bucketColorFor(999, b)).toBe(b[4]!.color);
  });

  it('mid-range values fall into the correct bucket', () => {
    // -5 is in [-10, 0) -> bucket[0]
    expect(bucketColorFor(-5, b)).toBe(b[0]!.color);
    // 5 is in [0, 10) -> bucket[1]
    expect(bucketColorFor(5, b)).toBe(b[1]!.color);
    // 15 is in [10, 25) -> bucket[2]
    expect(bucketColorFor(15, b)).toBe(b[2]!.color);
    // 35 is in [25, 50) -> bucket[3]
    expect(bucketColorFor(35, b)).toBe(b[3]!.color);
  });

  it('works with a custom 2-bucket scale', () => {
    const custom: MarginBucket[] = [
      { threshold: 0, color: 'oklch(54% 0.19 27)' },
      { threshold: 20, color: 'oklch(52% 0.13 155)' },
    ];
    expect(bucketColorFor(-5, custom)).toBe(custom[0]!.color);
    expect(bucketColorFor(0, custom)).toBe(custom[0]!.color);
    expect(bucketColorFor(10, custom)).toBe(custom[0]!.color);
    expect(bucketColorFor(20, custom)).toBe(custom[1]!.color);
    expect(bucketColorFor(100, custom)).toBe(custom[1]!.color);
  });

  it('MarginScale type is structurally compatible with MarginBucket[]', () => {
    const scale: MarginScale = { enabled: true, buckets: Array.from(b) };
    expect(scale.enabled).toBe(true);
    expect(scale.buckets).toHaveLength(5);
  });
});
