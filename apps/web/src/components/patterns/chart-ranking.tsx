'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { CHART_BRAND, resolveSeriesColor, resolveValueColor } from './chart-colors';
import { useChartAxisFormatter, useChartValueFormatter } from './chart-format';
import { ChartEmptyFrame } from './chart-states';
import type { ChartColorMode, ChartValueFormat } from './chart.types';

/**
 * Horizontal ranking / top-list — the kit's "which one wins" archetype, and the
 * one chart that is a LIST, not a continuous plot, so it's laid out in CSS
 * (thick bars, a label gutter / inside label, a fixed value column, an optional
 * value axis) rather than recharts. The everyday seller view: en kârlı ürünler,
 * en çok satan SKU, mağaza / kategori sıralaması.
 *
 * Rows sort descending. Height is content-driven (row count × a fixed bar
 * thickness), so bars stay thick and gaps stay tight no matter how many rows —
 * use it inside `<ChartFrame chartKind="ranking" height="auto">`.
 *
 * Two label placements (`labelMode`):
 * - `outside` (default) — label in a left gutter, value at the right, a value
 *   x-axis underneath (for all-positive data). Robust for long labels / many
 *   rows / any color mode.
 * - `inside` — label sits INSIDE the bar (white, truncated to the bar so it
 *   never spills), value in the right column, no axis. The denser "bar list"
 *   look; best with short labels + a saturated color mode (brand / semantic).
 *
 * Three coloring modes (`colorMode`): `brand` (one color, length is the signal),
 * `semantic` (per-row sign — kâr yeşil / zarar kırmızı, sub-zero rows extend left
 * of a zero divider), `categorical` (the palette per row).
 *
 * @useWhen ranking discrete items by a value — top products by profit, best
 *   sellers, a marketplace / category breakdown
 */
export interface RankingDatum {
  /** Row label (a product / category name). */
  label: string;
  value: number;
}

export interface RankingChartProps {
  data: ReadonlyArray<RankingDatum>;
  /** Label placement. Defaults to `outside` (gutter + axis). */
  labelMode?: 'outside' | 'inside';
  /** Bar coloring. Defaults to `brand` (length is the signal). */
  colorMode?: ChartColorMode;
  /** Value format for the value column + axis ticks. Defaults to `currency`. */
  format?: ChartValueFormat;
  /** Keep only the top N rows after sorting (descending). */
  topN?: number;
  className?: string;
  ariaLabel?: string;
}

// Number of axis divisions (→ 6 round ticks 0…max) for the outside-mode axis.
const AXIS_DIVISIONS = 5;

/** Round a positive value up to a "nice" 1 / 2 / 5 × 10ⁿ ceiling for the axis. */
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

/** Per-row fill from the color mode + value sign + rank index. */
function fillForMode(mode: ChartColorMode, value: number, index: number): string {
  if (mode === 'semantic') return resolveValueColor(value);
  if (mode === 'categorical') return resolveSeriesColor('categorical', index);
  return CHART_BRAND;
}

interface RankingRow {
  label: string;
  value: number;
  fill: string;
  /** Bar offset from the track's left edge, in %. */
  leftPct: number;
  /** Bar length, in %. */
  widthPct: number;
}

export function RankingChart({
  data,
  labelMode = 'outside',
  colorMode = 'brand',
  format = 'currency',
  topN,
  className,
  ariaLabel,
}: RankingChartProps): React.ReactElement {
  const t = useTranslations('common.chart');
  const valueFormatter = useChartValueFormatter();
  const axisFormatter = useChartAxisFormatter();
  const label = ariaLabel ?? t('a11y.chart');

  // Empty: render the kit's ranking-shaped empty frame (faint sorted rows).
  if (data.length === 0) {
    return <ChartEmptyFrame shape="ranking" yLabels={[]} ariaLabel={label} className={className} />;
  }

  const sorted = [...data].sort((a, b) => b.value - a.value);
  const limited = topN === undefined ? sorted : sorted.slice(0, topN);

  const values = limited.map((row) => row.value);
  const dataMax = Math.max(0, ...values);
  const dataMin = Math.min(0, ...values);
  const hasNegative = dataMin < 0;
  // The axis only fits all-positive outside-mode lists; semantic (signed) rows
  // get a zero divider instead, inside mode is axis-free.
  const showAxis = labelMode === 'outside' && !hasNegative && dataMax > 0;
  const trackMax = showAxis ? niceCeil(dataMax) : dataMax;
  const span = trackMax - dataMin || 1;
  const zeroPct = ((0 - dataMin) / span) * 100;

  const rows: RankingRow[] = limited.map((row, index) => {
    const widthPct = (Math.abs(row.value) / span) * 100;
    return {
      label: row.label,
      value: row.value,
      fill: fillForMode(colorMode, row.value, index),
      leftPct: row.value >= 0 ? zeroPct : zeroPct - widthPct,
      widthPct,
    };
  });

  const inside = labelMode === 'inside';
  const trackHeight = inside ? 'h-2xl' : 'h-xl';
  // structural: the ranking's column template (gutter? · track · value)
  const gridTemplateColumns = inside ? 'minmax(0, 1fr) auto' : 'auto minmax(0, 1fr) auto';
  const axisTicks = showAxis
    ? Array.from({ length: AXIS_DIVISIONS + 1 }, (_, i) => (trackMax * i) / AXIS_DIVISIONS)
    : [];

  return (
    <TooltipProvider delayDuration={0}>
      <div
        role="img"
        aria-label={label}
        className={cn('gap-x-sm gap-y-sm grid items-center', className)}
        // structural: ranking column template (label gutter / track / value)
        style={{ gridTemplateColumns }}
      >
        {rows.map((row, index) => (
          // Index key: labels aren't guaranteed unique (two SKUs can share a
          // name), and rows are re-derived fresh + sorted on every render.
          <React.Fragment key={index}>
            {inside ? null : (
              <span className="text-muted-foreground truncate text-right text-sm">{row.label}</span>
            )}
            <div className={cn('relative', trackHeight)}>
              {hasNegative ? (
                <div
                  className="border-border-strong absolute inset-y-0 border-l"
                  // runtime-dynamic: zero baseline position is data-driven
                  style={{ left: `${zeroPct}%` }}
                  aria-hidden
                />
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'duration-fast absolute inset-y-0 flex items-center overflow-hidden transition hover:brightness-110',
                      // Round only the free end; the edge on the zero / axis baseline stays square.
                      row.value >= 0 ? 'rounded-r-md' : 'rounded-l-md',
                    )}
                    // runtime-dynamic: bar offset/length + fill are value-driven
                    style={{
                      left: `${row.leftPct}%`,
                      width: `${row.widthPct}%`,
                      backgroundColor: row.fill,
                    }}
                  >
                    {inside ? (
                      <span className="text-primary-foreground px-sm truncate text-sm font-medium">
                        {row.label}
                      </span>
                    ) : null}
                  </div>
                </TooltipTrigger>
                {/* Same readout as the LineChart / BarChart single-series tooltip
                  (the `inverted` style): a dark label · value pill. */}
                <TooltipContent
                  side="top"
                  className="bg-foreground text-background gap-xs px-sm py-2xs flex items-center border-0 font-medium"
                >
                  <span className="opacity-70">{row.label}</span>
                  <span className="font-semibold tabular-nums">
                    {valueFormatter(row.value, format)}
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
            <span className="text-foreground text-right text-sm font-medium tabular-nums">
              {valueFormatter(row.value, format)}
            </span>
          </React.Fragment>
        ))}

        {showAxis ? (
          <>
            <span aria-hidden />
            <div className="border-border-muted pt-2xs mt-2xs h-md relative border-t">
              {axisTicks.map((tick, index) => (
                <span
                  key={index}
                  className={cn(
                    'text-2xs text-muted-foreground top-2xs absolute tabular-nums',
                    index === 0
                      ? ''
                      : index === axisTicks.length - 1
                        ? '-translate-x-full'
                        : '-translate-x-1/2',
                  )}
                  // runtime-dynamic: tick x-position is scale-driven
                  style={{ left: `${(index / AXIS_DIVISIONS) * 100}%` }}
                >
                  {axisFormatter(tick, format)}
                </span>
              ))}
            </div>
            <span aria-hidden />
          </>
        ) : null}
      </div>

      {/* role="img" makes the grid's descendant text presentational, so the
          per-row label + value — real HTML, since the ranking is the one chart
          rendered as DOM text rather than an SVG plot — would be silent to
          assistive tech. This sibling sr-only list (outside the img subtree)
          carries the ranking data so screen readers announce each row. */}
      <ul className="sr-only">
        {rows.map((row, index) => (
          <li key={index}>
            {row.label}: {valueFormatter(row.value, format)}
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}
