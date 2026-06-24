'use client';

import * as React from 'react';

import { useCountUp } from '@/lib/use-count-up';
import { cn } from '@/lib/utils';

export interface AnimatedNumberProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'children'
> {
  /** Numeric target the display tweens toward. */
  value: number;
  /** Formats the tweened number for display (e.g. formatCurrency, formatPercent). */
  format: (n: number) => string;
  /** Count from 0 on first mount (default true). */
  animateOnMount?: boolean;
}

/**
 * Renders a number that tweens (count-up / count-down) toward `value`. The
 * tween is display-only — the final frame formats the exact target. Use for
 * headline / KPI metrics only — never table cells, ids, or dates.
 *
 * @useWhen showing a headline / KPI metric that should roll up on load and tween on change (pass formatCurrency / formatPercent / formatNumber as `format`; opt out per-surface by not using it)
 */
export function AnimatedNumber({
  value,
  format,
  animateOnMount = true,
  className,
  ...props
}: AnimatedNumberProps): React.ReactElement {
  const current = useCountUp(value, { animateOnMount });
  return (
    <span className={cn('tabular-nums', className)} {...props}>
      {format(current)}
    </span>
  );
}
