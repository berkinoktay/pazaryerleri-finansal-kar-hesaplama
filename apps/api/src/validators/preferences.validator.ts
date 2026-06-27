import { z } from '@hono/zod-openapi';

/**
 * A single margin bucket: one threshold (%) and the colour to show when the
 * margin is at or above that threshold but below the next one.
 *
 * Range: threshold -100..1000 (int), color 1..64 chars.
 */
export const MarginBucketSchema = z
  .object({
    threshold: z
      .number()
      .int('INVALID_THRESHOLD_NOT_INT')
      .min(-100, 'INVALID_THRESHOLD_TOO_LOW')
      .max(1000, 'INVALID_THRESHOLD_TOO_HIGH'),
    color: z.string().min(1, 'INVALID_COLOR_EMPTY').max(64, 'INVALID_COLOR_TOO_LONG'),
  })
  .openapi('MarginBucket', {
    description:
      'A single threshold-colour pair in a margin coloring scale. ' +
      'Threshold is the lower bound (inclusive) for this bucket.',
    example: { threshold: 10, color: 'oklch(52% 0.13 155)' },
  });

export type MarginBucket = z.infer<typeof MarginBucketSchema>;

/**
 * Validates that every consecutive pair of buckets has a strictly increasing
 * threshold. Equal or descending thresholds are rejected.
 */
function hasStrictlyAscendingThresholds(buckets: MarginBucket[]): boolean {
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1];
    const curr = buckets[i];
    if (prev === undefined || curr === undefined) continue;
    if (curr.threshold <= prev.threshold) return false;
  }
  return true;
}

/**
 * Margin coloring scale: on/off toggle + 2–8 threshold-colour buckets.
 * Buckets must have strictly ascending (unique) thresholds.
 */
export const MarginColoringSchema = z
  .object({
    enabled: z.boolean(),
    buckets: z
      .array(MarginBucketSchema)
      .min(2, 'INVALID_BUCKETS_TOO_FEW')
      .max(8, 'INVALID_BUCKETS_TOO_MANY'),
  })
  .refine(({ buckets }) => hasStrictlyAscendingThresholds(buckets), {
    message: 'INVALID_BUCKETS_THRESHOLDS_NOT_ASCENDING',
    path: ['buckets'],
  })
  .openapi('MarginColoring', {
    description:
      'Threshold-based margin coloring scale. Buckets must have strictly ascending, ' +
      'unique thresholds. The first bucket covers "this value and below", the last ' +
      'covers "this value and above". Opt-in: set enabled=true to activate.',
    example: {
      enabled: true,
      buckets: [
        { threshold: -10, color: 'oklch(54% 0.19 27)' },
        { threshold: 0, color: 'oklch(58% 0.17 55)' },
        { threshold: 10, color: 'oklch(60% 0.15 80)' },
        { threshold: 25, color: 'oklch(56% 0.14 130)' },
        { threshold: 50, color: 'oklch(52% 0.13 155)' },
      ],
    },
  });

export type MarginColoring = z.infer<typeof MarginColoringSchema>;

/**
 * Top-level preferences blob stored in UserProfile.preferences.
 *
 * Designed to grow: add new optional keys here as new preference categories
 * land. The PATCH handler shallow-merges at this level so callers only need
 * to send the keys they are changing.
 */
export const PreferencesSchema = z
  .object({
    marginColoring: MarginColoringSchema.optional(),
  })
  .openapi('Preferences', {
    description:
      'User-scoped UI preferences persisted in UserProfile.preferences (JSONB). ' +
      'All keys are optional — send only the keys you want to change in PATCH.',
    example: {
      marginColoring: {
        enabled: false,
        buckets: [
          { threshold: -10, color: 'oklch(54% 0.19 27)' },
          { threshold: 10, color: 'oklch(52% 0.13 155)' },
        ],
      },
    },
  });

export type Preferences = z.infer<typeof PreferencesSchema>;

/**
 * Response wrapper: always returns the full current preferences blob.
 */
export const PreferencesResponseSchema = z
  .object({
    data: PreferencesSchema,
  })
  .openapi('PreferencesResponse', {
    description: "The authenticated user's current preferences.",
  });

export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;
