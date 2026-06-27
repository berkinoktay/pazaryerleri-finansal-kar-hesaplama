import type React from 'react';

import { profitToneClass } from '@/features/orders/lib/profit-tone';
import { bucketColorFor, type MarginScale } from '@/lib/margin-coloring';

/**
 * Derive display style props for a margin / profit value.
 *
 * - scale null OR !scale.enabled  -> binary Tailwind class via the existing
 *   `profitToneClass` helper (text-success / text-destructive / '').
 * - scale.enabled + parseable value -> threshold-mapped color via `style.color`
 *   (runtime-dynamic: user-defined margin scale color).
 * - value null / empty / '0' / '0.00' -> `{}` (neutral — no class, no style).
 */
export function marginColorStyle(
  value: string | null,
  scale: MarginScale | null,
): { className?: string; style?: React.CSSProperties } {
  // Neutral zero is always rendered without color, regardless of scale state.
  if (value === null || value === '' || value === '0' || value === '0.00') {
    return {};
  }

  // Scale disabled or absent: use the existing binary class helper.
  if (scale === null || !scale.enabled) {
    const cls = profitToneClass(value);
    return cls !== '' ? { className: cls } : {};
  }

  // Scale enabled: parse and map to a bucket color.
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return {};
  }

  return {
    style: {
      // runtime-dynamic: user-defined margin scale color
      color: bucketColorFor(numeric, scale.buckets),
    },
  };
}
