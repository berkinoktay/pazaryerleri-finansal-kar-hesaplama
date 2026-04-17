import Decimal from 'decimal.js';
import { formatCurrency } from '@pazarsync/utils';

import { cn } from '@/lib/utils';

export interface CurrencyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Monetary amount. Decimal preferred; string/number accepted for compatibility. */
  value: Decimal | string | number;
  /** Emphasize the value with heavier weight (for KPI values). */
  emphasis?: boolean;
  /** Dim when the value is zero/null so empty rows don't shout. */
  dimWhenZero?: boolean;
}

/**
 * Renders a Turkish Lira monetary value with tabular numerics so digits
 * line up vertically in tables and KPI rows. Delegates formatting to the
 * shared `@pazarsync/utils` formatter — single source of truth for ₺
 * display, thousand separators, and decimal places.
 */
export function Currency({
  value,
  emphasis = false,
  dimWhenZero = false,
  className,
  ...props
}: CurrencyProps): React.ReactElement {
  const decimal = value instanceof Decimal ? value : new Decimal(value);
  const isZero = decimal.isZero();

  return (
    <span
      data-tabular="true"
      className={cn(
        'tabular-nums',
        emphasis && 'font-semibold',
        dimWhenZero && isZero && 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      {formatCurrency(decimal)}
    </span>
  );
}
