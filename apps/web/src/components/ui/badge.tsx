import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Badge — compact status / label chip.
 *
 * `tone` carries the semantic meaning (success, warning, etc.); `size`
 * scales vertical weight (sm is for table cells, lg is for hero stats).
 * `radius` is shared with the rest of the design system — set `full`
 * for pill, `md` for square-ish, etc.
 */

const badgeVariants = cva('inline-flex items-center gap-3xs border font-medium transition-colors', {
  variants: {
    tone: {
      neutral: 'border-border bg-muted text-foreground',
      primary: 'border-transparent bg-primary text-primary-foreground',
      outline: 'border-border bg-transparent text-foreground',
      success: 'border-transparent bg-success-surface text-success',
      destructive: 'border-transparent bg-destructive-surface text-destructive',
      warning: 'border-transparent bg-warning-surface text-warning',
      info: 'border-transparent bg-info-surface text-info',
    },
    size: {
      sm: 'px-xs py-3xs text-2xs',
      md: 'px-sm py-3xs text-xs',
      lg: 'px-sm py-3xs text-sm',
    },
    radius: {
      none: 'rounded-none',
      xs: 'rounded-xs',
      sm: 'rounded-sm',
      md: 'rounded-md',
      lg: 'rounded-lg',
      xl: 'rounded-xl',
      '2xl': 'rounded-2xl',
      full: 'rounded-full',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'md', radius: 'full' },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, radius, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ tone, size, radius, className }))} {...props} />;
}

export { badgeVariants };
