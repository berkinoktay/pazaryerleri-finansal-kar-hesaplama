import { describe, expect, it } from 'vitest';

import {
  MarginBucketSchema,
  MarginColoringSchema,
  PreferencesSchema,
} from '@/validators/preferences.validator';

// ─── MarginBucketSchema ───────────────────────────────────────────────────────

describe('MarginBucketSchema', () => {
  it('accepts a valid bucket', () => {
    expect(
      MarginBucketSchema.safeParse({ threshold: 10, color: 'oklch(54% 0.19 27)' }).success,
    ).toBe(true);
  });

  it('rejects threshold below -100', () => {
    expect(MarginBucketSchema.safeParse({ threshold: -101, color: 'red' }).success).toBe(false);
  });

  it('rejects threshold above 1000', () => {
    expect(MarginBucketSchema.safeParse({ threshold: 1001, color: 'red' }).success).toBe(false);
  });

  it('rejects empty color string', () => {
    expect(MarginBucketSchema.safeParse({ threshold: 0, color: '' }).success).toBe(false);
  });

  it('rejects color string over 64 chars', () => {
    const longColor = 'a'.repeat(65);
    expect(MarginBucketSchema.safeParse({ threshold: 0, color: longColor }).success).toBe(false);
  });

  it('accepts threshold at boundary -100', () => {
    expect(MarginBucketSchema.safeParse({ threshold: -100, color: 'red' }).success).toBe(true);
  });

  it('accepts threshold at boundary 1000', () => {
    expect(MarginBucketSchema.safeParse({ threshold: 1000, color: 'red' }).success).toBe(true);
  });
});

// ─── MarginColoringSchema — ascending / uniqueness refine ─────────────────────

describe('MarginColoringSchema', () => {
  const validBuckets = [
    { threshold: -10, color: 'oklch(54% 0.19 27)' },
    { threshold: 10, color: 'oklch(52% 0.13 155)' },
  ];

  it('accepts enabled schema with strictly ascending thresholds', () => {
    const result = MarginColoringSchema.safeParse({ enabled: true, buckets: validBuckets });
    expect(result.success).toBe(true);
  });

  it('accepts disabled schema with valid buckets', () => {
    const result = MarginColoringSchema.safeParse({ enabled: false, buckets: validBuckets });
    expect(result.success).toBe(true);
  });

  it('rejects equal thresholds', () => {
    const result = MarginColoringSchema.safeParse({
      enabled: true,
      buckets: [
        { threshold: 10, color: 'x' },
        { threshold: 10, color: 'y' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects descending thresholds', () => {
    const result = MarginColoringSchema.safeParse({
      enabled: true,
      buckets: [
        { threshold: 20, color: 'x' },
        { threshold: 10, color: 'y' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects fewer than 2 buckets (1 bucket)', () => {
    const result = MarginColoringSchema.safeParse({
      enabled: true,
      buckets: [{ threshold: 0, color: 'red' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 8 buckets (9 buckets)', () => {
    const nineBuckets = Array.from({ length: 9 }, (_, i) => ({
      threshold: i * 10,
      color: 'red',
    }));
    const result = MarginColoringSchema.safeParse({ enabled: true, buckets: nineBuckets });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 8 buckets with strictly ascending thresholds', () => {
    const eightBuckets = Array.from({ length: 8 }, (_, i) => ({
      threshold: i * 10,
      color: 'red',
    }));
    const result = MarginColoringSchema.safeParse({ enabled: true, buckets: eightBuckets });
    expect(result.success).toBe(true);
  });

  it('accepts the plan spec example (5-bucket scale)', () => {
    const result = MarginColoringSchema.safeParse({
      enabled: true,
      buckets: [
        { threshold: -10, color: 'oklch(54% 0.19 27)' },
        { threshold: 0, color: 'oklch(58% 0.17 55)' },
        { threshold: 10, color: 'oklch(60% 0.15 80)' },
        { threshold: 25, color: 'oklch(56% 0.14 130)' },
        { threshold: 50, color: 'oklch(52% 0.13 155)' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ─── PreferencesSchema ────────────────────────────────────────────────────────

describe('PreferencesSchema', () => {
  it('accepts an empty preferences object', () => {
    expect(PreferencesSchema.safeParse({}).success).toBe(true);
  });

  it('accepts preferences with a valid marginColoring', () => {
    const result = PreferencesSchema.safeParse({
      marginColoring: {
        enabled: true,
        buckets: [
          { threshold: -10, color: 'red' },
          { threshold: 10, color: 'green' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when marginColoring has invalid (equal) thresholds', () => {
    const result = PreferencesSchema.safeParse({
      marginColoring: {
        enabled: true,
        buckets: [
          { threshold: 10, color: 'x' },
          { threshold: 10, color: 'y' },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts preferences without marginColoring (undefined = opt-out)', () => {
    expect(PreferencesSchema.safeParse({ marginColoring: undefined }).success).toBe(true);
  });
});
