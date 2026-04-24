import Decimal from 'decimal.js';

import { Currency } from '@/components/patterns/currency';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /**
   * The primary value. Currency type renders ₺ via the shared formatter;
   * count type renders an integer with tr-TR grouping.
   */
  value:
    | { kind: 'currency'; amount: Decimal | string | number }
    | { kind: 'count'; amount: number };
  /** Period-over-period percent delta to display as a chip next to the value. */
  delta?: { percent: number; goodDirection?: 'up' | 'down' };
  /** Subtext anchored under the value — comparison window, source, or caveat. */
  context?: string;
  /** Stretch tile across 2 columns on larger screens when this metric is the headline. */
  wide?: boolean;
  /**
   * Optional sparkline points (0..1 normalised on Y, evenly spaced on X).
   * When provided, renders as a watermark behind the value at low opacity.
   */
  sparkline?: readonly number[];
  /** Sparkline tint — defaults to `--color-primary`. */
  sparklineTone?: 'primary' | 'success' | 'destructive' | 'info' | 'warning';
}

const TONE_COLOR: Record<NonNullable<KpiTileProps['sparklineTone']>, string> = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  destructive: 'var(--color-destructive)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
};

/**
 * Canonical KPI tile. Value-first hierarchy: the number is the hero, label
 * reads as context above, delta + timestamp are quiet companions below.
 * Never painted in accent color — rare exception earns its color, not the
 * default. Use semantic chips (TrendDelta) for directional coloring.
 *
 * Optional `sparkline` adds a low-opacity SVG trace behind the value, à la
 * Stripe / Mercury / Melontik tile design. Tone defaults to primary.
 */
export function KpiTile({
  label,
  value,
  delta,
  context,
  wide = false,
  sparkline,
  sparklineTone,
  className,
  ...props
}: KpiTileProps): React.ReactElement {
  const hasSparkline = sparkline !== undefined && sparkline.length > 1;
  return (
    <Card
      className={cn(
        'gap-md p-lg relative flex flex-col justify-between overflow-hidden',
        wide && 'sm:col-span-2',
        className,
      )}
      {...props}
    >
      {hasSparkline ? <Sparkline points={sparkline} tone={sparklineTone ?? 'primary'} /> : null}
      <div className="gap-md relative flex flex-col justify-between">
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
              {new Intl.NumberFormat('tr-TR').format(value.amount)}
            </span>
          )}
          {delta ? <TrendDelta value={delta.percent} goodDirection={delta.goodDirection} /> : null}
        </div>
        {context ? <p className="text-2xs text-muted-foreground">{context}</p> : null}
      </div>
    </Card>
  );
}

function Sparkline({
  points,
  tone,
}: {
  points: readonly number[];
  tone: NonNullable<KpiTileProps['sparklineTone']>;
}): React.ReactElement {
  const stroke = TONE_COLOR[tone];
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - p * 100;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full opacity-15"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
