'use client';

import * as React from 'react';

import { InfoHint } from '@/components/patterns/info-hint';
import { type StatCardDelta } from '@/components/patterns/stat-card';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Compact segmented KPI strip — several metrics in ONE hairline card, divided by
 * thin lines: the page-top summary row (Linear / Stripe dashboard vocabulary).
 * Each cell carries a bold title (+ optional `InfoHint`), an optional trailing
 * circular icon, the value, and a period + delta line. Denser than a row of
 * standalone `StatCard`s — for the at-a-glance header band; reach for `StatGroup`
 * + `StatCard` when each metric earns its own surface.
 *
 * Responsive without a hardcoded column count: stacked with top dividers on
 * narrow screens, a single equal-width row with left dividers from `lg` up
 * (`grid-flow-col` + `auto-cols-fr`). Tooltips portal out, so the card needs no
 * `overflow` clip.
 *
 * @useWhen showing a dense at-a-glance KPI summary band across the top of a page (use StatGroup + StatCard for richer, individually-surfaced metrics)
 */
export interface StatStripItem {
  label: string;
  value: React.ReactNode;
  /** Explanation surfaced via an `InfoHint` (ⓘ) next to the title. */
  hint?: React.ReactNode;
  delta?: StatCardDelta;
  /**
   * Muted one-liner under the value that gives the number MEANING — a
   * comparison, a nudge ("3 tarife dışa aktarım bekliyor") or, for an empty
   * metric, real microcopy instead of a bare em-dash. Renders alongside
   * `delta` when both are present.
   */
  context?: React.ReactNode;
  /** Trailing circular icon (a `SoftSquareIcon shape="circle" variant="soft"`). */
  icon?: React.ReactNode;
}

export interface StatStripProps extends React.HTMLAttributes<HTMLDivElement> {
  items: ReadonlyArray<StatStripItem>;
  /**
   * Render skeleton cells (same count and anatomy as `items`) instead of the
   * values. Labels/icons come from `items` config as usual — only the value
   * and context lines are placeholders, so the strip neither collapses nor
   * shows a misleading flash of zeros while the query is in flight.
   */
  loading?: boolean;
  /** Accessible name for the loading region (e.g. `t('common.loading')`). */
  loadingLabel?: string;
}

function StatStripCell({
  item,
  loading = false,
}: {
  item: StatStripItem;
  loading?: boolean;
}): React.ReactElement {
  return (
    <div className="p-lg gap-sm border-border-muted flex flex-col border-t first:border-t-0 lg:border-t-0 lg:border-l lg:first:border-l-0">
      <div className="gap-md flex items-start justify-between">
        <span className="gap-2xs flex min-w-0 items-center">
          <span className="text-foreground truncate text-sm font-semibold tracking-tight">
            {item.label}
          </span>
          {item.hint !== undefined ? <InfoHint label={item.label}>{item.hint}</InfoHint> : null}
        </span>
        {item.icon !== undefined ? <span className="shrink-0">{item.icon}</span> : null}
      </div>
      {loading ? (
        // Loading keeps the REAL label + icon (static config) and swaps only
        // the data: a value-height bar and a context-line bar. The cell keeps
        // its loaded anatomy, so nothing jumps when the numbers land.
        <>
          <Skeleton className="h-7 w-24" />
          <div className="mt-auto flex items-center">
            <Skeleton className="h-3.5 w-20" />
          </div>
        </>
      ) : (
        <>
          <span className="text-foreground text-3xl leading-none font-semibold tracking-tight tabular-nums">
            {item.value}
          </span>
          {item.delta !== undefined || item.context !== undefined ? (
            // mt-auto pins the context/delta line to the CELL BOTTOM: when a
            // sibling's value wraps to two lines the grid stretches every cell,
            // and bottom-anchoring keeps the small lines reading as one aligned
            // row across the strip.
            <div className="gap-xs mt-auto flex flex-wrap items-center">
              {item.delta?.period !== undefined && item.delta.period !== '' ? (
                <span className="text-2xs text-muted-foreground-dim tabular-nums">
                  {item.delta.period}
                </span>
              ) : null}
              {item.delta !== undefined ? (
                <TrendDelta value={item.delta.percent} goodDirection={item.delta.goodDirection} />
              ) : null}
              {item.context !== undefined ? (
                <span className="text-2xs text-muted-foreground">{item.context}</span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Fully-skeleton variant of the strip for callers that don't know the cell
 * labels yet (route-level `loading.tsx`, generic page skeletons). Feature
 * code that owns its item config should prefer `<StatStrip loading>` — it
 * keeps the real labels/icons and swaps only the data.
 */
export function StatStripSkeleton({
  cells = 4,
  className,
}: {
  cells?: number;
  className?: string;
}): React.ReactElement {
  return (
    <Card
      className={cn(
        'animate-panel-enter grid grid-cols-1 lg:auto-cols-fr lg:grid-flow-col',
        className,
      )}
    >
      {Array.from({ length: cells }).map((_, idx) => (
        <div
          key={idx}
          className="p-lg gap-sm border-border-muted flex flex-col border-t first:border-t-0 lg:border-t-0 lg:border-l lg:first:border-l-0"
        >
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-24" />
          <div className="mt-auto flex items-center">
            <Skeleton className="h-3.5 w-16" />
          </div>
        </div>
      ))}
    </Card>
  );
}

export function StatStrip({
  items,
  loading = false,
  loadingLabel,
  className,
  ...props
}: StatStripProps): React.ReactElement {
  return (
    <Card
      role={loading ? 'status' : undefined}
      aria-busy={loading || undefined}
      aria-label={loading ? loadingLabel : undefined}
      className={cn(
        'animate-panel-enter grid grid-cols-1 lg:auto-cols-fr lg:grid-flow-col',
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <StatStripCell key={item.label} item={item} loading={loading} />
      ))}
    </Card>
  );
}
