'use client';

import { Alert02Icon, RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import { InfoHint } from '@/components/patterns/info-hint';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The kit's metric card — a value-first statistic surface, composed from
 * optional slots so one component covers the dashboard family: an icon-hero
 * tile, a metric + inline trend, an action card, or a breakdown (pass a
 * `DistributionBar` as `children`). Value is the hero; label, delta, trend, and
 * footer are quiet companions. Wrap a row of them in `StatGroup`, or a compact
 * row in `StatStrip`.
 *
 * Optional `hint` adds an `InfoHint` (ⓘ + tooltip) beside the label. `status`
 * drives loading / empty / error without the caller re-shaping the card.
 * `href` / `onClick` make the whole card a drill-down via a stretched-link
 * overlay — interactive children (the hint, the action) stay clickable above it.
 *
 * @useWhen rendering a single headline metric with optional icon, delta, inline trend, breakdown, or drill-down (compose into a StatGroup grid or a StatStrip row)
 */
export interface StatCardDelta {
  /** Percent change (e.g. 12.4 → +12.4%). */
  percent: number;
  /** Which direction is "good" — up for revenue/profit, down for cost/returns. */
  goodDirection?: 'up' | 'down';
  /** Optional absolute change beside the chip (e.g. a `+₺1.470` node). */
  absolute?: React.ReactNode;
  /** Optional comparison phrase (e.g. "geçen haftaya göre"). */
  period?: string;
}

export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Metric name — eyebrow by default, a prominent title when `emphasis`. */
  label: string;
  /** Headline value node (a `<Currency />` or number). */
  value: React.ReactNode;
  /** Explanation surfaced via an `InfoHint` (ⓘ) next to the label. */
  hint?: React.ReactNode;
  /** Period-over-period delta — chip + optional absolute + period phrase. */
  delta?: StatCardDelta;
  /** Decorative metric icon (a circular `SoftSquareIcon`). */
  icon?: React.ReactNode;
  /** Icon placement: `leading` (left of label) or `trailing` (top-right). */
  iconPosition?: 'leading' | 'trailing';
  /** Quiet muted sub-line below the delta (comparison, freshness, a note). */
  context?: React.ReactNode;
  /** Inline mini-chart (a `Sparkline`) beside the value. */
  trend?: React.ReactNode;
  /** Trailing action — a CTA button / link ("Raporu gör →"). */
  action?: React.ReactNode;
  /** Trust footer — source / freshness line. */
  footer?: React.ReactNode;
  /** Render `label` as a prominent title instead of an eyebrow (hero / action cards). */
  emphasis?: boolean;
  status?: 'ready' | 'loading' | 'empty' | 'error';
  /** Retry handler for `status='error'`. */
  onRetry?: () => void;
  /** Whole-card drill-down link (stretched-link overlay). */
  href?: string;
  /** Whole-card drill-down handler (stretched-button overlay). */
  onClick?: () => void;
  /** Accessible name for the drill-down overlay; defaults to `label`. */
  drillLabel?: string;
  /** Extended body below the value (e.g. a `DistributionBar`). */
  children?: React.ReactNode;
}

const OVERLAY_CLASS =
  'focus-visible:ring-ring absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

function StatCardSkeleton({
  emphasis,
  hasIcon,
  hasTrend,
  className,
}: {
  emphasis?: boolean;
  hasIcon?: boolean;
  hasTrend?: boolean;
  className?: string;
}): React.ReactElement {
  const t = useTranslations('common');
  return (
    <Card
      role="status"
      aria-busy
      aria-label={t('chart.loading')}
      className={cn('p-lg gap-md flex flex-col', className)}
    >
      <div className="gap-2xs flex items-center justify-between">
        <Skeleton className={emphasis ? 'h-lg w-4xl' : 'h-sm w-3xl'} />
        {hasIcon ? <Skeleton radius="full" className="size-9" /> : null}
      </div>
      <div className="gap-md flex items-end justify-between">
        <div className="gap-sm flex flex-col">
          <Skeleton className="h-xl w-4xl" />
          <Skeleton className="h-md w-3xl" />
        </div>
        {hasTrend ? <Skeleton className="h-2xl w-3xl" /> : null}
      </div>
    </Card>
  );
}

export function StatCard({
  label,
  value,
  hint,
  delta,
  icon,
  iconPosition = 'leading',
  context,
  trend,
  action,
  footer,
  emphasis = false,
  status = 'ready',
  onRetry,
  href,
  onClick,
  drillLabel,
  children,
  className,
  ...props
}: StatCardProps): React.ReactElement {
  const t = useTranslations('common');

  if (status === 'loading') {
    return (
      <StatCardSkeleton
        emphasis={emphasis}
        hasIcon={icon !== undefined}
        hasTrend={trend !== undefined}
        className={className}
      />
    );
  }

  const clickable = status === 'ready' && (href !== undefined || onClick !== undefined);

  const labelEl = emphasis ? (
    <span className="text-foreground text-lg font-semibold tracking-tight">{label}</span>
  ) : (
    <span className="text-2xs text-muted-foreground min-w-0 truncate font-medium tracking-wide uppercase">
      {label}
    </span>
  );

  const labelRow =
    icon !== undefined || hint !== undefined || label ? (
      <div className="gap-md flex items-start justify-between">
        <span className="gap-2xs flex min-w-0 items-center">
          {icon !== undefined && iconPosition === 'leading' ? (
            <span className="shrink-0">{icon}</span>
          ) : null}
          {labelEl}
          {hint !== undefined ? (
            <span className="relative z-10 inline-flex">
              <InfoHint label={label}>{hint}</InfoHint>
            </span>
          ) : null}
        </span>
        {icon !== undefined && iconPosition === 'trailing' ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
      </div>
    ) : null;

  let body: React.ReactNode;
  if (status === 'error') {
    body = (
      <div role="alert" className="gap-xs text-muted-foreground flex flex-col items-start">
        <span className="gap-2xs text-foreground flex items-center text-sm font-medium">
          <Alert02Icon className="size-icon-sm text-destructive" />
          {t('stat.loadError')}
        </span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2xs relative z-10">
            <RefreshIcon className="size-icon-sm" />
            {t('stat.retry')}
          </Button>
        ) : null}
      </div>
    );
  } else if (status === 'empty') {
    body = (
      <span className="text-muted-foreground-dim text-4xl leading-none font-semibold tabular-nums">
        —
      </span>
    );
  } else {
    const valueColumn = (
      <div className="gap-sm flex min-w-0 flex-col">
        <span className="text-foreground text-4xl leading-none font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {delta ? (
          <div className="gap-xs flex flex-wrap items-center">
            <TrendDelta value={delta.percent} goodDirection={delta.goodDirection} />
            {delta.absolute !== undefined ? (
              <span className="text-foreground text-sm font-medium tabular-nums">
                {delta.absolute}
              </span>
            ) : null}
            {delta.period ? (
              <span className="text-2xs text-muted-foreground-dim tabular-nums">
                {delta.period}
              </span>
            ) : null}
          </div>
        ) : null}
        {context !== undefined ? (
          <span className="text-2xs text-muted-foreground tabular-nums">{context}</span>
        ) : null}
      </div>
    );
    body =
      trend !== undefined ? (
        <div className="gap-md flex items-center justify-between">
          {valueColumn}
          <div className="shrink-0">{trend}</div>
        </div>
      ) : (
        valueColumn
      );
  }

  return (
    <Card
      className={cn(
        'p-lg gap-md flex flex-col',
        clickable &&
          'duration-fast ease-out-quart relative cursor-pointer transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md',
        className,
      )}
      {...props}
    >
      {labelRow}
      {body}
      {children !== undefined ? <div className="relative z-10">{children}</div> : null}
      {action !== undefined ? <div className="relative z-10 flex">{action}</div> : null}
      {footer !== undefined ? (
        <div className="border-border-muted text-2xs text-muted-foreground-dim pt-md border-t tabular-nums">
          {footer}
        </div>
      ) : null}
      {clickable && href !== undefined ? (
        <Link href={href} aria-label={drillLabel ?? label} className={OVERLAY_CLASS} />
      ) : null}
      {clickable && href === undefined && onClick !== undefined ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={drillLabel ?? label}
          className={OVERLAY_CLASS}
        />
      ) : null}
    </Card>
  );
}
