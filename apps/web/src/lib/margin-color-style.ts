import type React from 'react';

import { bucketColorFor, DEFAULT_MARGIN_BUCKETS, type MarginScale } from '@/lib/margin-coloring';

/**
 * How much of the resolved scale color tints the badge fill / border. The scale
 * colors are tuned as TEXT colors (~48-64% lightness); mixing them toward
 * transparent yields a pale same-hue surface — the `surface` badge look — that
 * keeps the saturated color as readable text and composites over striped/hover
 * rows. Tune these two numbers to make the fill louder or quieter.
 */
const BADGE_FILL_MIX_PERCENT = 16;
const BADGE_BORDER_MIX_PERCENT = 30;

/**
 * Inline color style for a margin value, applied ON TOP of a cell's existing
 * (binary / colorless) appearance. Returns `undefined` when coloring is off or
 * absent, or when the value isn't a finite number — so the cell renders exactly
 * as it did before this feature (byte-identical OFF state). When the scale is
 * enabled, the returned inline `color` overrides any class-based color (inline
 * style wins over a class).
 *
 * Callers keep their own original tone class (e.g. `profitToneClass(value)` or
 * none) and just spread this style; the row's MARGIN drives the color so a
 * row's margin% and net-profit cells share the same bucket color.
 */
export function marginColorStyle(
  margin: string | null,
  scale: MarginScale | null,
): React.CSSProperties | undefined {
  if (scale === null || !scale.enabled) return undefined;
  if (margin === null || margin === '') return undefined;
  const numeric = Number(margin);
  if (Number.isNaN(numeric)) return undefined;
  // runtime-dynamic: user-defined margin scale color
  return { color: bucketColorFor(numeric, scale.buckets) };
}

/**
 * Inline style for the estimated-profit BADGE — a tinted, color-filled chip
 * whose hue tracks the row's margin on a red→green scale. Unlike
 * `marginColorStyle`, it ALWAYS produces a color so the badge is never
 * colorless: the user's scale when enabled, otherwise the built-in default
 * ramp (`DEFAULT_MARGIN_BUCKETS`). It returns `undefined` only when the margin
 * itself is missing / unparseable — the caller then renders a neutral badge.
 *
 * Returns the saturated scale color as the `color` (text) plus a same-hue
 * translucent `backgroundColor` and `borderColor` (mixed toward transparent),
 * so the fill reads as a pale tint over any row background while the text stays
 * WCAG-legible.
 */
export function marginBadgeStyle(
  margin: string | null,
  scale: MarginScale | null,
): React.CSSProperties | undefined {
  if (margin === null || margin === '') return undefined;
  const numeric = Number(margin);
  if (Number.isNaN(numeric)) return undefined;
  // Always color: the user's scale when enabled, otherwise the default ramp.
  const buckets = scale !== null && scale.enabled ? scale.buckets : DEFAULT_MARGIN_BUCKETS;
  const color = bucketColorFor(numeric, buckets);
  // runtime-dynamic: tinted fill/border derived from the (user or default) scale color
  return {
    color,
    backgroundColor: `color-mix(in oklab, ${color} ${BADGE_FILL_MIX_PERCENT}%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} ${BADGE_BORDER_MIX_PERCENT}%, transparent)`,
  };
}
