'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import { ChartSwatch } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

/**
 * Horizontal part-to-whole bar + optional legend list — a compact composition
 * breakdown for a StatCard (gelir dağılımı, pazaryeri payı) or anywhere a total
 * splits into a few labelled shares. A single thin stacked bar shows the
 * proportions; the legend reads colour · label · value · share. The flat sibling
 * of the donut: same data, a fraction of the vertical space, so it fits inside a
 * metric card under a hero value.
 *
 * Each segment is caller-coloured (`var(--color-chart-N)`) and the legend dot is
 * the kit's single `ChartSwatch` so it reads identically to every chart legend.
 *
 * @useWhen showing a total's composition inline under a metric (use DonutChart for a standalone share chart)
 */
export interface DistributionSegment {
  label: string;
  /** Display value node (e.g. a `<Currency />`). */
  value: React.ReactNode;
  /** Share of the whole, 0..100. Drives the bar width and the legend %. */
  percent: number;
  /** Segment colour — a `var(--color-chart-N)` token. */
  color: string;
}

export interface DistributionBarProps {
  segments: ReadonlyArray<DistributionSegment>;
  /** Render the colour · label · value · % legend below the bar. Default true. */
  showLegend?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function DistributionBar({
  segments,
  showLegend = true,
  ariaLabel,
  className,
}: DistributionBarProps): React.ReactElement {
  const formatter = useFormatter();
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="gap-3xs flex h-2.5 w-full" role="img" aria-label={ariaLabel}>
        {segments.map((segment) => (
          <span
            key={segment.label}
            className="rounded-xs"
            // runtime-dynamic: segment width is its share, colour is the palette token
            style={{ width: `${segment.percent}%`, backgroundColor: segment.color }}
          />
        ))}
      </div>
      {showLegend ? (
        <div className="mt-md flex flex-col">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className="gap-sm border-border-muted py-sm flex items-center border-t text-sm first:border-t-0"
            >
              <ChartSwatch color={segment.color} />
              <span className="text-foreground font-medium">{segment.label}</span>
              <span className="text-foreground ml-auto font-medium tabular-nums">
                {segment.value}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatter.number(segment.percent / 100, 'percentInt')}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
