/**
 * Margin coloring scale — types, curated palette, default buckets, and the
 * threshold-lookup helper. Pure module: no React, no side-effects.
 *
 * Contrast notes (WCAG AA, >= 4.5:1):
 * - Light bg: oklch(98-100% 0 0)  — requires text lightness roughly <= 60% at mid chroma.
 * - Dark  bg: oklch(14-17% 0.01 265) — requires text lightness roughly >= 57% at mid chroma.
 * - All SWATCH_PALETTE entries are tuned to ~57-62% lightness so a single stored
 *   color string reads at >= 4.5:1 on both light and dark neutral backgrounds.
 *   The colorblind-safe orange stop is slightly lower (55%) to maintain hue clarity;
 *   the blue stop is slightly higher (62%) to stay visible on dark.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single step in a margin coloring scale. */
export type MarginBucket = {
  /** Lower-bound threshold (inclusive). First bucket has no lower bound; last has no upper. */
  readonly threshold: number;
  /** OKLCH color string used for this bucket's text. */
  readonly color: string;
};

/** A user-configurable margin coloring scale. */
export type MarginScale = {
  /** When false the binary (success/destructive) fallback is used. */
  readonly enabled: boolean;
  readonly buckets: readonly MarginBucket[];
};

// ---------------------------------------------------------------------------
// Curated swatch palette
// ---------------------------------------------------------------------------

/**
 * ~14 OKLCH color stops spanning red -> amber -> green plus colorblind-safe
 * blue / orange / neutral stops. Every entry targets ~57-62% lightness at
 * moderate chroma so it reads >= 4.5:1 on both light card (oklch 100% 0 0)
 * and dark card (oklch 17% 0.012 265) backgrounds.
 *
 * Hue landmarks:
 *   27  = destructive red (matches --destructive token hue)
 *   50  = orange-red
 *   75  = warning amber (matches --warning token hue)
 *   95  = yellow-green
 *  115  = fresh green
 *  155  = success green (matches --success token hue)
 *  200  = teal (chart-2 hue)
 *  240  = info blue (matches --info token hue)
 *  265  = brand violet (chart-1 hue)
 *   50 (orange, CB-safe pair with 240 blue)
 */
export const SWATCH_PALETTE = [
  // --- Red spectrum ---
  'oklch(58% 0.20 27)', // vivid red — strong loss signal
  'oklch(59% 0.18 50)', // orange-red
  // --- Amber / yellow-green ---
  'oklch(57% 0.17 75)', // warning amber
  'oklch(60% 0.16 95)', // yellow-green
  // --- Green spectrum ---
  'oklch(59% 0.15 115)', // fresh mid-green
  'oklch(58% 0.15 140)', // green
  'oklch(58% 0.14 155)', // success green
  // --- Neutral / muted ---
  'oklch(57% 0.07 155)', // desaturated green (conservative)
  'oklch(57% 0.07 27)', // desaturated red (conservative)
  // --- Colorblind-safe blue / orange ---
  'oklch(59% 0.15 240)', // CB-safe blue (info hue)
  'oklch(57% 0.17 200)', // teal
  'oklch(58% 0.17 60)', // CB-safe orange
  // --- Additional stops ---
  'oklch(60% 0.13 265)', // brand violet (neutral / special)
  'oklch(62% 0.14 310)', // pink-violet (chart-6 hue)
] as const satisfies readonly string[];

// ---------------------------------------------------------------------------
// Default 5-bucket scale (red -> orange -> amber -> light-green -> green)
// ---------------------------------------------------------------------------

/**
 * Default 5-bucket scale mapped to standard profit zones:
 *   bucket[0]: ..up to -10%  -> red
 *   bucket[1]: -10..0%       -> orange-red
 *   bucket[2]:   0..10%      -> warning amber
 *   bucket[3]:  10..25%      -> fresh green
 *   bucket[4]:  25%..        -> success green
 */
export const DEFAULT_MARGIN_BUCKETS = [
  { threshold: -10, color: SWATCH_PALETTE[0] }, // red
  { threshold: 0, color: SWATCH_PALETTE[2] }, // amber (0% margin = break-even zone)
  { threshold: 10, color: SWATCH_PALETTE[4] }, // fresh green
  { threshold: 25, color: SWATCH_PALETTE[5] }, // green
  { threshold: 50, color: SWATCH_PALETTE[6] }, // success green
] as const satisfies readonly MarginBucket[];

// ---------------------------------------------------------------------------
// Preset scales
// ---------------------------------------------------------------------------

/** Colorblind-safe 5-bucket scale: blue -> neutral -> orange. */
const COLORBLIND_BUCKETS: MarginBucket[] = [
  { threshold: -10, color: SWATCH_PALETTE[9] }, // CB-safe blue (loss)
  { threshold: 0, color: SWATCH_PALETTE[11] }, // CB-safe orange (break-even)
  { threshold: 10, color: SWATCH_PALETTE[10] }, // teal
  { threshold: 25, color: SWATCH_PALETTE[6] }, // success green
  { threshold: 50, color: SWATCH_PALETTE[6] }, // success green (reinforced)
];

/**
 * Named preset scales. `redGreen` mirrors the default; `colorblind` uses
 * a blue-orange-teal variant that avoids red/green confusion.
 */
export const PRESET_SCALES: Record<'redGreen' | 'colorblind', MarginBucket[]> = {
  redGreen: Array.from(DEFAULT_MARGIN_BUCKETS),
  colorblind: COLORBLIND_BUCKETS,
} as const;

// ---------------------------------------------------------------------------
// Threshold lookup
// ---------------------------------------------------------------------------

/**
 * Map a margin percentage to the matching bucket color.
 *
 * Buckets must be provided in ascending threshold order. The lookup semantics:
 *   - bucket_i covers [threshold_i, threshold_{i+1})
 *   - The first bucket also covers everything below threshold_0 (no lower bound).
 *   - The last bucket covers threshold_{n-1} and everything above (no upper bound).
 *   - A value exactly equal to a threshold belongs to that bucket (lower-bound inclusive).
 *
 * @param marginPct  The margin percentage as a plain number (e.g. 25.7 for 25.7%).
 * @param buckets    The ordered bucket array. Must have at least one entry.
 */
export function bucketColorFor(marginPct: number, buckets: readonly MarginBucket[]): string {
  // Walk from the last bucket downwards. The first bucket whose threshold
  // is <= marginPct is the matching one (lower-bound inclusive).
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (marginPct >= buckets[i]!.threshold) {
      return buckets[i]!.color;
    }
  }
  // marginPct is below the first bucket's threshold — still the first bucket.
  return buckets[0]!.color;
}
