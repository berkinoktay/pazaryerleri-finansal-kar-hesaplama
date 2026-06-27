/**
 * Margin coloring scale — types, palette, default buckets, presets, and the
 * threshold-lookup helper. Pure module: no React, no side-effects.
 *
 * These colors are used as TEXT colors on both the light card background
 * (oklch ~100%) and the dark card (oklch ~17%). To clear WCAG AA (>= 4.5:1) on
 * BOTH, every stop is tuned to ~48-64% lightness. That ceiling is why warm
 * mid-hues (pure yellow) can't appear — they'd be unreadable on white — so the
 * default ramp goes red -> orange -> yellow-green -> green and skips muddy gold.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single step in a margin coloring scale. */
export type MarginBucket = {
  /** Lower-bound threshold (inclusive). First bucket has no lower bound; last has no upper. */
  readonly threshold: number;
  /** CSS color string used for this bucket's text. */
  readonly color: string;
};

/** A user-configurable margin coloring scale. */
export type MarginScale = {
  /** When false the binary (success/destructive) fallback is used. */
  readonly enabled: boolean;
  readonly buckets: readonly MarginBucket[];
};

/** Identifier for a built-in preset color ramp. */
export type PresetKey = 'redGreen' | 'colorblind' | 'purpleGreen' | 'sunset' | 'mono';

// ---------------------------------------------------------------------------
// Swatch palette — the quick-pick grid in ColorSwatchPicker
// ---------------------------------------------------------------------------

/**
 * A varied set of text-readable color stops (all ~48-64% lightness so they read
 * on both light and dark card backgrounds). Grouped by family so the picker
 * grid reads as an organized spectrum. Users who want anything else use the
 * custom color input in the picker.
 */
export const SWATCH_PALETTE = [
  // reds
  'oklch(54% 0.21 27)',
  'oklch(62% 0.19 30)',
  // oranges
  'oklch(60% 0.17 50)',
  'oklch(64% 0.15 65)',
  // golds (darker — text-safe)
  'oklch(58% 0.13 90)',
  // yellow-greens / greens
  'oklch(60% 0.16 130)',
  'oklch(56% 0.16 150)',
  'oklch(48% 0.16 152)',
  'oklch(62% 0.10 155)',
  // teals / cyans
  'oklch(57% 0.13 195)',
  'oklch(60% 0.12 220)',
  // blues
  'oklch(55% 0.16 250)',
  'oklch(60% 0.15 265)',
  // indigos / purples
  'oklch(55% 0.18 290)',
  'oklch(58% 0.17 320)',
  // magenta / pink
  'oklch(58% 0.20 350)',
  // neutrals
  'oklch(62% 0.03 250)',
  'oklch(48% 0.02 250)',
] as const satisfies readonly string[];

// ---------------------------------------------------------------------------
// Preset ramps — ordered loss -> profit color stops
// ---------------------------------------------------------------------------

/**
 * Each preset is an ordered ramp (loss on the left, profit on the right).
 * Applying a preset re-colors the CURRENT buckets by sampling N evenly-spaced
 * stops from the ramp, so it works for any bucket count and keeps thresholds.
 */
export const PRESET_RAMPS: Record<PresetKey, readonly string[]> = {
  // Clean red -> orange -> yellow-green -> green (skips muddy gold).
  redGreen: [
    'oklch(54% 0.21 27)',
    'oklch(62% 0.17 45)',
    'oklch(60% 0.15 120)',
    'oklch(56% 0.16 150)',
    'oklch(48% 0.16 153)',
  ],
  // Color-blind safe: orange (loss) <-> blue (profit) — distinguishable for
  // deuteranopia/protanopia (Okabe-Ito style); never relies on red vs green.
  colorblind: [
    'oklch(58% 0.16 42)', // vermillion-orange (loss)
    'oklch(64% 0.12 70)', // amber
    'oklch(70% 0.04 230)', // near-neutral
    'oklch(60% 0.12 235)', // sky blue
    'oklch(52% 0.16 255)', // strong blue (profit)
  ],
  // Color-blind safe diverging: purple (loss) <-> green (profit).
  purpleGreen: [
    'oklch(52% 0.18 305)',
    'oklch(62% 0.12 320)',
    'oklch(70% 0.03 280)',
    'oklch(60% 0.13 150)',
    'oklch(50% 0.16 152)',
  ],
  // Warm sunset: deep red -> orange -> gold -> teal -> blue.
  sunset: [
    'oklch(54% 0.20 25)',
    'oklch(62% 0.16 55)',
    'oklch(60% 0.12 90)',
    'oklch(58% 0.12 195)',
    'oklch(55% 0.15 250)',
  ],
  // Single-hue intensity (green getting deeper) — calm, minimal.
  mono: [
    'oklch(72% 0.07 155)',
    'oklch(64% 0.11 153)',
    'oklch(56% 0.14 152)',
    'oklch(48% 0.15 151)',
    'oklch(40% 0.13 150)',
  ],
} as const;

/** Display order + i18n key suffix for the preset selector. */
export const PRESET_KEYS: readonly PresetKey[] = [
  'redGreen',
  'colorblind',
  'purpleGreen',
  'sunset',
  'mono',
] as const;

/**
 * Sample `n` evenly-spaced colors from a ramp. n === ramp.length returns the
 * ramp as-is; otherwise picks indices across the ramp so any bucket count maps
 * onto the full loss->profit spread.
 */
export function sampleRamp(ramp: readonly string[], n: number): string[] {
  if (n <= 1) return [ramp[0]!];
  if (n >= ramp.length) {
    // Repeat-extend by clamping the last stop (rare: more buckets than stops).
    return Array.from({ length: n }, (_, i) => ramp[Math.min(i, ramp.length - 1)]!);
  }
  const step = (ramp.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => ramp[Math.round(i * step)]!);
}

/** Re-color the given buckets from a preset ramp, preserving thresholds. */
export function applyPreset(buckets: readonly MarginBucket[], preset: PresetKey): MarginBucket[] {
  const colors = sampleRamp(PRESET_RAMPS[preset], buckets.length);
  return buckets.map((b, i) => ({ threshold: b.threshold, color: colors[i]! }));
}

// ---------------------------------------------------------------------------
// Default 5-bucket scale
// ---------------------------------------------------------------------------

/**
 * Default scale: thresholds at the common profit zones, colored from the
 * redGreen ramp. bucket[0] = loss (red) ... bucket[4] = strong profit (green).
 */
export const DEFAULT_MARGIN_BUCKETS: readonly MarginBucket[] = applyPreset(
  [
    { threshold: -10, color: '' },
    { threshold: 0, color: '' },
    { threshold: 10, color: '' },
    { threshold: 25, color: '' },
    { threshold: 50, color: '' },
  ],
  'redGreen',
);

// ---------------------------------------------------------------------------
// Threshold lookup
// ---------------------------------------------------------------------------

/**
 * Map a margin percentage to the matching bucket color. Buckets must be in
 * ascending threshold order. The first bucket also covers everything below its
 * threshold; the last covers its threshold and above; a value equal to a
 * threshold belongs to that bucket (lower-bound inclusive).
 */
export function bucketColorFor(marginPct: number, buckets: readonly MarginBucket[]): string {
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (marginPct >= buckets[i]!.threshold) {
      return buckets[i]!.color;
    }
  }
  return buckets[0]!.color;
}
