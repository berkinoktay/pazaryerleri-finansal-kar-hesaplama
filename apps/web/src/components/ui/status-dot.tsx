import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Small semantic colored dot for inline status indicators — sync
 * state, online/offline, store fresh/stale/failed, "unread" markers.
 * Cheaper than reaching for a Badge when only the dot is needed:
 * Badge is a labeled chip with its own padding and tone surface;
 * StatusDot is the dot alone, paired separately with whatever
 * label (or no label) the caller chooses.
 *
 * Decorative by default (aria-hidden) — pass `label` to announce the
 * status to screen readers when the visible context doesn't already
 * convey it. Color alone is never the only signal in PazarSync, so the
 * caller is responsible for ensuring an accompanying icon, sign, or
 * label exists in the surrounding markup.
 *
 * Sizes: `sm` (6px) for very tight rows, `md` (8px, default) for
 * standard inline use. Tones use the same semantic vocabulary as
 * Badge / Alert / TrendDelta so cross-component consistency holds.
 *
 * @useWhen marking inline status with just a colored dot (use Badge when the dot needs an inline label, SyncBadge for the canonical sync-state surface)
 */

const statusDotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    tone: {
      neutral: 'bg-muted-foreground',
      success: 'bg-success',
      warning: 'bg-warning',
      destructive: 'bg-destructive',
      info: 'bg-info',
      primary: 'bg-primary',
    },
    size: {
      sm: 'size-1.5',
      md: 'size-2',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'md' },
});

export interface StatusDotProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, 'aria-label'>,
    VariantProps<typeof statusDotVariants> {
  /**
   * Translated status label. When provided the dot becomes a
   * `role="status"` element and screen readers announce the label;
   * when omitted the dot is purely decorative and ignored by AT.
   */
  label?: string;
}

export function StatusDot({
  tone,
  size,
  label,
  className,
  ...props
}: StatusDotProps): React.ReactElement {
  const classes = cn(statusDotVariants({ tone, size }), className);
  if (label !== undefined) {
    return <span role="status" aria-label={label} className={classes} {...props} />;
  }
  return <span aria-hidden className={classes} {...props} />;
}

export { statusDotVariants };
