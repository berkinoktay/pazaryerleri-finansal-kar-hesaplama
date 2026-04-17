import Decimal from 'decimal.js';
import { ArrowUp01Icon, ArrowDown01Icon } from 'hugeicons-react';
import { formatPercent } from '@pazarsync/utils';

import { cn } from '@/lib/utils';

export interface TrendDeltaProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Percent delta as a number (e.g. 12.4 means +12.4%). */
  value: Decimal | number;
  /**
   * Semantic direction of a "good" change:
   * - "up" means higher is better (revenue, profit)
   * - "down" means lower is better (refunds, cost)
   *
   * Used to decide whether positive values read as success or destructive.
   */
  goodDirection?: 'up' | 'down';
  /** Size of the delta chip. */
  size?: 'sm' | 'md';
}

/**
 * Displays a percentage delta with explicit sign, arrow icon, AND color —
 * all three channels so color-blind users still get the direction. Color
 * alone is never the sole signal of good/bad in a financial product.
 */
export function TrendDelta({
  value,
  goodDirection = 'up',
  size = 'sm',
  className,
  ...props
}: TrendDeltaProps): React.ReactElement {
  const num = typeof value === 'number' ? value : value.toNumber();
  const isZero = num === 0;
  const isPositive = num > 0;
  const isGood = isZero ? true : goodDirection === 'up' ? isPositive : !isPositive;

  const Arrow = isZero ? null : isPositive ? ArrowUp01Icon : ArrowDown01Icon;
  const sign = isZero ? '' : isPositive ? '+' : '−';

  return (
    <span
      data-tabular="true"
      className={cn(
        'gap-3xs px-xs py-3xs inline-flex items-center rounded-full font-medium tabular-nums',
        size === 'sm' ? 'text-2xs' : 'text-xs',
        isZero && 'bg-muted text-muted-foreground',
        !isZero && isGood && 'bg-success-surface text-success',
        !isZero && !isGood && 'bg-destructive-surface text-destructive',
        className,
      )}
      {...props}
    >
      {Arrow ? <Arrow className="size-icon-xs" /> : null}
      <span>
        {sign}
        {formatPercent(Math.abs(num))}
      </span>
    </span>
  );
}
