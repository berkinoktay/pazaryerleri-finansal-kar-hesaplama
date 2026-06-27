import type React from 'react';

import { bucketColorFor, type MarginScale } from '@/lib/margin-coloring';

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
