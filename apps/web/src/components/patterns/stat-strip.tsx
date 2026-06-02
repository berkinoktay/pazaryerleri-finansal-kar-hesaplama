'use client';

import * as React from 'react';

import { InfoHint } from '@/components/patterns/info-hint';
import { type StatCardDelta } from '@/components/patterns/stat-card';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Card } from '@/components/ui/card';
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
  /** Trailing circular icon (a `SoftSquareIcon shape="circle" variant="outline"`). */
  icon?: React.ReactNode;
}

export interface StatStripProps extends React.HTMLAttributes<HTMLDivElement> {
  items: ReadonlyArray<StatStripItem>;
}

function StatStripCell({ item }: { item: StatStripItem }): React.ReactElement {
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
      <span className="text-foreground text-3xl leading-none font-semibold tracking-tight tabular-nums">
        {item.value}
      </span>
      {item.delta ? (
        <div className="gap-xs flex flex-wrap items-center">
          {item.delta.period ? (
            <span className="text-2xs text-muted-foreground-dim tabular-nums">
              {item.delta.period}
            </span>
          ) : null}
          <TrendDelta value={item.delta.percent} goodDirection={item.delta.goodDirection} />
        </div>
      ) : null}
    </div>
  );
}

export function StatStrip({ items, className, ...props }: StatStripProps): React.ReactElement {
  return (
    <Card className={cn('grid grid-cols-1 lg:auto-cols-fr lg:grid-flow-col', className)} {...props}>
      {items.map((item) => (
        <StatStripCell key={item.label} item={item} />
      ))}
    </Card>
  );
}
