'use client';

import { Alert02Icon, RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { ChartShape } from './chart.types';
import { EmptyState } from './empty-state';

/**
 * The non-data states a ChartFrame swaps the plot for. Both the loading skeleton
 * and the empty frame match the chart's `shape` (`line` | `bar` | `ranking` |
 * `donut`) so each chart's non-data states keep its own orientation (a column
 * chart never shows a line silhouette; a donut shows a ring, not bars):
 * - `ChartSkeleton shape` — the LOADING placeholder: for `line` / `bar`, a value
 *   y-gutter + hairline gridlines + a pulsing area silhouette / pulsing columns;
 *   for `ranking`, sorted pulsing pill rows; for `donut`, a pulsing ring + legend
 *   stubs. Reads as "the chart, data coming", never a generic grey box.
 * - `ChartEmptyFrame shape` — for `line` / `bar`, the chart's real empty axes
 *   (labels + gridlines, plus faint columns for `bar`); for `ranking`, faint
 *   sorted pill rows; for `donut`, a faint ring + legend stubs (no value axis).
 * - `ChartEmptyHint` — the quiet "no data" pill overlaid on the empty frame.
 * - `ChartError` — a destructive-tone block with a retry action.
 */

// Rising area silhouette for the line loading placeholder (stretched to fill).
const SILHOUETTE =
  'M0 80 C40 76 62 64 100 60 C150 54 172 40 212 36 C252 32 280 26 300 22 L300 100 L0 100 Z';

// Fractional bar heights for the bar shape's column placeholders — Tailwind
// height utilities (no arbitrary values), varied so the row reads as bars.
const BAR_HEIGHTS = ['h-1/2', 'h-4/5', 'h-3/5', 'h-full', 'h-2/3', 'h-2/5', 'h-5/6'] as const;

// Uniform rows for the ranking skeleton — a label stub + a thick full-width bar
// — plus an axis-tick dot row, mirroring the live ranking's content-height layout.
const RANKING_SKELETON_ROWS = [0, 1, 2, 3, 4, 5];
const RANKING_AXIS_DOTS = [0, 1, 2, 3, 4];

// Five evenly-spaced rows — the y-axis gutter labels and the gridlines share
// the same count so they line up.
const GRID_TICKS = [0, 1, 2, 3, 4];
const X_TICKS = [0, 1, 2, 3, 4, 5];

/** Column placeholders for the bar shape — pulsing for loading, faint+static for empty. */
function PlotBars({ animated, faint }: { animated: boolean; faint?: boolean }): React.ReactElement {
  return (
    <div className="gap-xs absolute inset-0 flex items-end">
      {BAR_HEIGHTS.map((height) => (
        <Skeleton
          key={height}
          animated={animated}
          radius="none"
          className={cn('flex-1 rounded-t-sm', height, faint && 'opacity-50')}
        />
      ))}
    </div>
  );
}

/**
 * Row placeholders for the horizontal RANKING shape: a left label stub + a
 * descending-width pill per row, so loading / empty read as a sorted top-list
 * (not a column chart). Pulsing for loading, faint+static for empty.
 */
function RankingRows({
  animated,
  faint,
}: {
  animated: boolean;
  faint?: boolean;
}): React.ReactElement {
  return (
    <div className="gap-sm flex flex-col">
      {RANKING_SKELETON_ROWS.map((row) => (
        <div key={row} className="gap-sm flex items-center">
          <Skeleton
            animated={animated}
            radius="xs"
            className={cn('h-2xs w-2xl shrink-0', faint && 'opacity-50')}
          />
          <Skeleton
            animated={animated}
            className={cn('h-xl flex-1 rounded-md', faint && 'opacity-50')}
          />
        </div>
      ))}
      {/* axis tick dots, aligned under the track (past the label stub) */}
      <div className="gap-sm flex items-center">
        <span className="w-2xl shrink-0" aria-hidden />
        <div className="flex flex-1 justify-between">
          {RANKING_AXIS_DOTS.map((dot) => (
            <Skeleton
              key={dot}
              animated={animated}
              radius="full"
              className={cn('size-2xs', faint && 'opacity-50')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Legend-row count for the donut skeleton / empty figure.
const DONUT_LEGEND_ROWS = [0, 1, 2, 3];

/**
 * Ring + side-legend placeholder for the donut shape — a pulsing / faint ring (a
 * full circle with a card-coloured hole) beside a few legend-row stubs, matching
 * the live donut's layout.
 */
function DonutFigure({
  animated,
  faint,
}: {
  animated: boolean;
  faint?: boolean;
}): React.ReactElement {
  return (
    <div className="gap-lg flex h-full items-center">
      <div className="relative aspect-square h-full shrink-0 self-stretch">
        <Skeleton
          radius="full"
          animated={animated}
          className={cn('h-full w-full', faint && 'opacity-50')}
        />
        <div className="bg-card absolute inset-1/4 rounded-full" aria-hidden />
      </div>
      <div className="gap-sm flex flex-1 flex-col">
        {DONUT_LEGEND_ROWS.map((row) => (
          <div key={row} className="gap-sm flex items-center">
            <Skeleton
              radius="full"
              animated={animated}
              className={cn('size-2xs shrink-0', faint && 'opacity-50')}
            />
            <Skeleton
              radius="xs"
              animated={animated}
              className={cn('h-2xs flex-1', faint && 'opacity-50')}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ shape = 'line' }: { shape?: ChartShape }): React.ReactElement {
  const t = useTranslations('common.chart');
  // Ranking is horizontal: skip the value y-gutter + gridlines and show sorted
  // pill rows instead.
  if (shape === 'ranking') {
    return (
      <div className="w-full" role="status" aria-busy aria-label={t('loading')}>
        <RankingRows animated />
      </div>
    );
  }
  if (shape === 'donut') {
    return (
      <div className="h-full w-full" role="status" aria-busy aria-label={t('loading')}>
        <DonutFigure animated />
      </div>
    );
  }
  return (
    <div className="gap-xs flex h-full w-full" role="status" aria-busy aria-label={t('loading')}>
      {/* y-axis label gutter — placeholders aligned to the gridlines */}
      <div className="py-2xs flex w-2xl flex-col items-end justify-between">
        {GRID_TICKS.map((i) => (
          <Skeleton key={i} radius="xs" className="h-2xs w-lg" />
        ))}
      </div>

      <div className="flex flex-1 flex-col">
        {/* plot — hairline gridlines (last = stronger zero baseline) + shape */}
        <div className="relative flex flex-1 flex-col justify-between">
          {GRID_TICKS.map((i) => (
            <div
              key={i}
              className={cn(
                'border-t',
                i === GRID_TICKS.length - 1 ? 'border-border-strong' : 'border-chart-grid',
              )}
            />
          ))}
          {shape === 'bar' ? (
            <PlotBars animated />
          ) : (
            <svg
              className="absolute inset-0 h-full w-full animate-pulse"
              viewBox="0 0 300 100"
              preserveAspectRatio="none"
            >
              <path d={SILHOUETTE} fill="var(--color-muted)" />
            </svg>
          )}
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
 * the "no data" hint. For `shape="bar"` it adds faint static column placeholders
 * so the empty bar chart reads as bars, not a bare line grid. Decorative for
 * a11y (the hint carries the message), so `aria-hidden` on the plot.
 */
export function ChartEmptyFrame({
  yLabels,
  ariaLabel,
  className,
  shape = 'line',
}: {
  yLabels: ReadonlyArray<string>;
  ariaLabel?: string;
  className?: string;
  shape?: ChartShape;
}): React.ReactElement {
  // Ranking is horizontal + content-height — no value axis to label; show faint
  // sorted rows (label stub + bar) instead.
  if (shape === 'ranking') {
    return (
      <div className={cn('w-full', className)} role="img" aria-label={ariaLabel}>
        <RankingRows animated={false} faint />
      </div>
    );
  }
  if (shape === 'donut') {
    return (
      <div className={cn('h-full w-full', className)} role="img" aria-label={ariaLabel}>
        <DonutFigure animated={false} faint />
      </div>
    );
  }
  return (
    <div className={cn('gap-xs flex h-full w-full', className)} role="img" aria-label={ariaLabel}>
      {/* y-axis labels — right-aligned, distributed to match the gridlines */}
      <div className="py-2xs text-2xs text-muted-foreground flex w-2xl shrink-0 flex-col items-end justify-between tabular-nums">
        {yLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {/* dashed hairline gridlines (last = stronger zero baseline) + bar placeholders */}
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
        {shape === 'bar' ? <PlotBars animated={false} faint /> : null}
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
