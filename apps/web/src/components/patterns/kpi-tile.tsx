'use client';

import Decimal from 'decimal.js';
import { useFormatter } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /**
   * The primary value. Currency type renders ₺ via the shared formatter;
   * count type renders an integer with locale-aware grouping (resolved via
   * next-intl from the active NextIntlClientProvider locale).
   */
  value:
    | { kind: 'currency'; amount: Decimal | string | number }
    | { kind: 'count'; amount: number };
  /** Period-over-period percent delta to display as a chip next to the value. */
  delta?: { percent: number; goodDirection?: 'up' | 'down' };
  /**
   * Quiet companion below the value — comparison line, freshness
   * timestamp, or a richer node like an inline Sparkline. Strings
   * (the typical case) render as muted small text; pass a node for
   * composed contexts (`<Sparkline /> + <span>...`).
   */
  context?: React.ReactNode;
  /** Stretch tile across 2 columns on larger screens when this metric is the headline. */
  wide?: boolean;
}

/**
 * Canonical KPI tile. Value-first hierarchy: the number is the hero, label
 * reads as context above, delta + timestamp are quiet companions below.
 * Never painted in accent color — rare exception earns its color, not the
 * default. Use semantic chips (TrendDelta) for directional coloring. Pair
 * with StatGroup for a row of equivalent metrics.
 *
 * @useWhen rendering a single headline metric with optional period-delta and context line (compose into a StatGroup row for primary KPI strip)
 */
export function KpiTile({
  label,
  value,
  delta,
  context,
  wide = false,
  className,
  ...props
}: KpiTileProps): React.ReactElement {
  const formatter = useFormatter();
  return (
    <Card
      className={cn(
        'gap-md p-lg flex flex-col justify-between',
        wide && 'sm:col-span-2',
        className,
      )}
      {...props}
    >
      <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
        {label}
      </span>
      <div className="gap-sm flex items-baseline">
        {value.kind === 'currency' ? (
          <Currency
            value={value.amount}
            emphasis
            className="text-foreground text-4xl font-semibold tracking-tight"
          />
        ) : (
          <span
            data-tabular="true"
            className="text-foreground text-4xl font-semibold tracking-tight tabular-nums"
          >
            {formatter.number(value.amount, 'integer')}
          </span>
        )}
        {delta ? <TrendDelta value={delta.percent} goodDirection={delta.goodDirection} /> : null}
      </div>
      {context ? <p className="text-2xs text-muted-foreground">{context}</p> : null}
    </Card>
  );
}
