'use client';

import { Alert02Icon, RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';

/**
 * The non-data states a ChartFrame swaps the plot for. Empty is the exception —
 * ChartFrame keeps the chart's OWN real empty axes for empty and only overlays
 * `ChartEmptyHint`, so the only swapped-in placeholders are loading and error:
 * - `ChartSkeleton` — the LOADING placeholder: a chart-SHAPED shimmer (y-axis
 *   gutter, hairline gridlines matching the real chart, x-axis placeholders) +
 *   a soft area silhouette, all pulsing. Reads as "the chart, data coming",
 *   never a generic grey box or two stray lines.
 * - `ChartEmptyHint` — the quiet "no data" pill overlaid on the real empty plot.
 * - `ChartError` — a destructive-tone block with a retry action.
 */

// Rising area silhouette for the loading placeholder (stretched to fill).
const SILHOUETTE =
  'M0 80 C40 76 62 64 100 60 C150 54 172 40 212 36 C252 32 280 26 300 22 L300 100 L0 100 Z';

const GRIDLINES = [0, 1, 2, 3, 4];
const Y_TICKS = [0, 1, 2, 3, 4];
const X_TICKS = [0, 1, 2, 3, 4, 5];

export function ChartSkeleton(): React.ReactElement {
  const t = useTranslations('common.chart');
  return (
    <div className="gap-xs flex h-full w-full" role="status" aria-busy aria-label={t('loading')}>
      {/* y-axis label gutter — placeholders aligned to the gridlines */}
      <div className="py-2xs flex w-2xl flex-col items-end justify-between">
        {Y_TICKS.map((i) => (
          <Skeleton key={i} radius="xs" className="h-2xs w-lg" />
        ))}
      </div>

      <div className="flex flex-1 flex-col">
        {/* plot — hairline gridlines (last = stronger zero baseline) + silhouette */}
        <div className="relative flex flex-1 flex-col justify-between">
          {GRIDLINES.map((i) => (
            <div
              key={i}
              className={cn(
                'border-t',
                i === GRIDLINES.length - 1 ? 'border-border-strong' : 'border-chart-grid',
              )}
            />
          ))}
          <svg
            className="absolute inset-0 h-full w-full animate-pulse"
            viewBox="0 0 300 100"
            preserveAspectRatio="none"
          >
            <path d={SILHOUETTE} fill="var(--color-muted)" />
          </svg>
        </div>

        {/* x-axis label placeholders */}
        <div className="pt-2xs flex justify-between">
          {X_TICKS.map((i) => (
            <Skeleton key={i} radius="xs" className="h-2xs w-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The chart's own empty frame: real right-aligned y-axis labels + dashed
 * hairline gridlines (last = the stronger zero baseline), matching the live
 * chart's grid. recharts can't render axes from an empty data array, so each
 * archetype formats its y-tick labels and hands them here; ChartFrame overlays
 * the "no data" hint. No pulse, no placeholder bars — the genuine frame, just
 * dataless. Decorative for a11y (the hint carries the message), so `aria-hidden`.
 */
export function ChartEmptyFrame({
  yLabels,
  ariaLabel,
  className,
}: {
  yLabels: ReadonlyArray<string>;
  ariaLabel?: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('gap-xs flex h-full w-full', className)} role="img" aria-label={ariaLabel}>
      {/* y-axis labels — right-aligned, distributed to match the gridlines */}
      <div className="py-2xs text-2xs text-muted-foreground flex w-2xl shrink-0 flex-col items-end justify-between tabular-nums">
        {yLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {/* dashed hairline gridlines (last = stronger zero baseline) */}
      <div className="py-2xs relative flex flex-1 flex-col justify-between" aria-hidden>
        {yLabels.map((label, index) => (
          <div
            key={label}
            className={cn(
              'border-t border-dashed',
              index === yLabels.length - 1 ? 'border-border-strong' : 'border-chart-grid',
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function ChartEmptyHint({ text }: { text?: string }): React.ReactElement {
  const t = useTranslations('common.chart');
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="bg-card text-muted-foreground border-border px-sm py-3xs text-2xs rounded-full border shadow-sm">
        {text ?? t('empty')}
      </span>
    </div>
  );
}

export function ChartError({ onRetry }: { onRetry?: () => void }): React.ReactElement {
  const t = useTranslations('common.chart');
  // Reuse the shared EmptyState (embedded + destructive tone) so the chart
  // error reads identically to the table error and lives in one place; wrap
  // in role="alert" since EmptyState is a neutral container.
  return (
    <div role="alert" className="h-full">
      <EmptyState
        embedded
        icon={Alert02Icon}
        iconTone="destructive"
        title={t('error.title')}
        description={t('error.description')}
        className="h-full justify-center"
        action={
          onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-2xs">
              <RefreshIcon className="size-icon-sm" />
              {t('error.retry')}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
