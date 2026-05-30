import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Small semantic colored dot for inline status indicators — sync state,
 * online/offline, store fresh/stale/failed, "unread" markers. Cheaper than a
 * Badge when only the dot (optionally + a label) is needed.
 *
 * Pass `label` to render the text inline beside the dot (`inline-flex` with a
 * baked-in gap) — the text IS the accessible name, so the dot itself is
 * decorative. Omit `label` for a bare dot (decorative; the caller must provide
 * an adjacent label/icon — color is never the only signal in PazarSync).
 *
 * `animatePulse` opts into the gentle sync-pulse (the "alive" indicator for an
 * actively-syncing store). Sizes: `sm` (6px) for tight rows, `md` (8px,
 * default), `lg` (12px) for standalone prominence. Tones use the same semantic
 * vocabulary as Badge / Alert / TrendDelta.
 *
 * @useWhen marking inline status with a colored dot (+ optional label); use Badge when the status needs a full chip surface
 */

const statusDotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    tone: {
      neutral: 'bg-muted-foreground',
      primary: 'bg-primary',
      success: 'bg-success',
      warning: 'bg-warning',
      destructive: 'bg-destructive',
      info: 'bg-info',
    },
    size: {
      sm: 'size-1.5',
      md: 'size-2',
      lg: 'size-3',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'md' },
});

export interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusDotVariants> {
  /** Inline label rendered beside the dot. The text is the accessible name (the dot becomes decorative). */
  label?: React.ReactNode;
  /** Opt into the gentle sync-pulse — use for an actively-syncing "alive" indicator. */
  animatePulse?: boolean;
}

export function StatusDot({
  tone,
  size,
  label,
  animatePulse = false,
  className,
  ...props
}: StatusDotProps): React.ReactElement {
  const dotClass = cn(statusDotVariants({ tone, size }), animatePulse && 'animate-sync-pulse');

  if (label !== undefined) {
    return (
      <span className={cn('gap-xs inline-flex items-center', className)} {...props}>
        <span aria-hidden className={dotClass} />
        {label}
      </span>
    );
  }
  return <span aria-hidden className={cn(dotClass, className)} {...props} />;
}

export { statusDotVariants };
