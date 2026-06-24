import Decimal from 'decimal.js';
import { formatCurrency } from '@pazarsync/utils';

import { cn } from '@/lib/utils';

import { AnimatedNumber } from './animated-number';

export interface CurrencyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Monetary amount. Decimal preferred; string/number accepted for compatibility. */
  value: Decimal | string | number;
  /** Emphasize the value with heavier weight (for KPI values). */
  emphasis?: boolean;
  /** Dim when the value is zero/null so empty rows don't shout. */
  dimWhenZero?: boolean;
  /** Tween the value (count-up) on mount/change. Headline / KPI only — never tables. */
  animate?: boolean;
}

/**
 * Renders a Turkish Lira monetary value with tabular numerics so digits
 * line up vertically in tables and KPI rows. Delegates formatting to the
 * shared `@pazarsync/utils` formatter — single source of truth for ₺
 * display, thousand separators, and decimal places. For input use the
 * future MoneyInput molecule; this is display-only.
 *
 * @useWhen displaying a TRY monetary value anywhere in the product (always pass Decimal when available, never compute money in floats)
 */
export function Currency({
  value,
  emphasis = false,
  dimWhenZero = false,
  animate = false,
  className,
  ...props
}: CurrencyProps): React.ReactElement {
  const decimal = value instanceof Decimal ? value : new Decimal(value);
  const isZero = decimal.isZero();
  const classes = cn(
    'tabular-nums',
    emphasis && 'font-semibold',
    dimWhenZero && isZero && 'text-muted-foreground',
    className,
  );

  // Opt-in count-up for headline / KPI usage. formatCurrency accepts number, so
  // it doubles as the AnimatedNumber formatter. Table cells never pass `animate`.
  if (animate) {
    return (
      <AnimatedNumber
        value={decimal.toNumber()}
        format={formatCurrency}
        data-tabular="true"
        className={classes}
        {...props}
      />
    );
  }

  return (
    <span data-tabular="true" className={classes} {...props}>
      {formatCurrency(decimal)}
    </span>
  );
}
