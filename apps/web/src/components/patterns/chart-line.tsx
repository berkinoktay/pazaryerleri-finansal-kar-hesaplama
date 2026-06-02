'use client';

import * as React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import {
  CHART_X_AXIS_PROPS,
  CHART_Y_AXIS_PROPS,
  CURSOR_DASH,
  GRID_DASH,
  PLOT_MARGIN,
  chartEmptyYLabels,
} from './chart-cartesian';
import {
  CHART_COMPARISON,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  CHART_ZERO_LINE,
  getZeroGradientOffset,
  resolveSeriesColor,
} from './chart-colors';
import { useChartAxisFormatter, useChartValueFormatter } from './chart-format';
import { ChartEmptyFrame } from './chart-states';
import type { ChartColorMode, ChartDatum, ChartSeries } from './chart.types';

/**
 * Line / area chart over a continuous x-axis — the kit's workhorse time chart.
 * One component, three coloring modes (driven by `colorMode`):
 *
 * - `semantic` (default) — value-driven kâr=yeşil / zarar=kırmızı, split at the
 *   zero baseline via a hard-stop gradient (`getZeroGradientOffset`). The P&L
 *   default, since most PazarSync charts are profit/loss.
 * - `brand` — a single brand-violet line for a neutral metric with no +/- sign
 *   meaning (order count, sync volume).
 * - `categorical` — the qualitative palette, for a one-off non-semantic series.
 *
 * An optional `comparison` series (e.g. "Dün") renders as a muted, dashed,
 * fill-less REFERENCE line drawn on top of the subject's fill so it never
 * competes for attention; the tooltip then switches from the single-value
 * crosshair readout to a two-row card (subject first, reference second).
 *
 * With no data it renders its OWN empty frame (`ChartEmptyFrame`) — real y-axis
 * labels + dashed gridlines — because recharts can't draw axes from an empty
 * array. Wrap in `<ChartFrame>` for chrome (header, states, trust footer).
 *
 * @useWhen plotting a metric over time — P&L (default), a neutral trend
 *   (`colorMode="brand"`), or two periods side by side (`comparison`)
 */
export interface LineChartProps {
  data: ReadonlyArray<ChartDatum>;
  xKey: string;
  series: ChartSeries;
  /**
   * Optional reference series drawn muted + dashed (no fill) for period-over-
   * period comparison (e.g. yesterday vs today). Its values live on the SAME
   * data rows under `comparison.key`; rows where only the comparison covers a
   * range (future hours) leave the subject line correctly short.
   */
  comparison?: ChartSeries;
  /** How the subject series resolves its color. Defaults to `semantic` (P&L). */
  colorMode?: ChartColorMode;
  /** `area` (default) fills toward the baseline; `line` is stroke-only. */
  variant?: 'area' | 'line';
  /**
   * Only meaningful for `semantic`: `split` (default) colors each segment by
   * its sign; `sign` colors the whole series by its net sign (hides intraday
   * dips).
   */
  zeroCrossing?: 'split' | 'sign';
  /**
   * Marks the subject series' last point with a pulsing "now" dot — for a live
   * / in-progress series whose line stops mid-axis (today so far). Off by
   * default; never use it on a completed range (the dot would imply live data).
   */
  liveDot?: boolean;
  showCrosshair?: boolean;
  xTickFormatter?: (value: string | number) => string;
  className?: string;
  ariaLabel?: string;
}

// Line-family stroke constants (grid / cursor / axis defaults live in the shared
// chart-cartesian module). The comparison reference line gets the longest dash
// so it never reads as a gridline, and rides translucent so it recedes behind
// the subject — a quiet backdrop, not a co-equal line.
const COMPARISON_DASH = '5 4';
const COMPARISON_OPACITY = 0.55;

/**
 * Leading-edge "now" marker drawn via `<ReferenceDot shape>`: a solid core dot
 * ringed in the card color (so it lifts off the line/fill) with a pulsing halo
 * behind it (`animate-chart-live-ping`). recharts hands the shape the resolved
 * pixel `cx`/`cy`; we guard the (rare) undefined case so the return type stays a
 * single SVG element.
 */
function ChartLiveDot({
  cx,
  cy,
  color,
}: {
  cx?: number;
  cy?: number;
  color: string;
}): React.ReactElement {
  if (cx === undefined || cy === undefined) return <g />;
  return (
    <g>
      {/* runtime-dynamic: halo + core color is the leading-edge value's color */}
      <circle cx={cx} cy={cy} r={5} fill={color} className="animate-chart-live-ping" />
      <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="var(--color-card)" strokeWidth={2} />
    </g>
  );
}

export function LineChart({
  data,
  xKey,
  series,
  comparison,
  colorMode = 'semantic',
  variant = 'area',
  zeroCrossing = 'split',
  liveDot = false,
  showCrosshair = true,
  xTickFormatter,
  className,
  ariaLabel,
}: LineChartProps): React.ReactElement {
  const id = React.useId();
  const fillId = `line-fill-${id}`;
  const strokeId = `line-stroke-${id}`;
  const valueFormatter = useChartValueFormatter();
  const axisFormatter = useChartAxisFormatter();
  const formatAxis = (value: number | string): string =>
    axisFormatter(Number(value), series.format);

  // Chart-sized arrays — plain derived values, no memo bookkeeping. `slice()`
  // hands recharts the mutable array its prop type wants (our `data` is readonly).
  const rows = data.slice();
  // Filter non-finite so rows the subject series doesn't cover (e.g. future
  // hours only the comparison spans) don't poison the net sign or the gradient.
  const values = rows.map((row) => Number(row[series.key])).filter(Number.isFinite);

  // Empty: recharts can't draw axes from an empty array (a truly empty array
  // yields only the two boundary gridlines and no tick labels), so render the
  // chart's OWN frame — real y-axis labels + dashed gridlines. ChartFrame
  // overlays the quiet "no data" hint; nothing else plots (no line / tooltip /
  // live dot), keeping the rest of this component on the has-data happy path.
  if (values.length === 0) {
    return (
      <ChartEmptyFrame
        yLabels={chartEmptyYLabels(formatAxis)}
        ariaLabel={ariaLabel ?? series.label}
        className={className}
      />
    );
  }

  const isSemantic = colorMode === 'semantic';
  const split = isSemantic && zeroCrossing === 'split';
  const netPositive = values.reduce((sum, value) => sum + value, 0) >= 0;
  const offset = getZeroGradientOffset(values);
  // Resolved solid color: semantic picks by net sign, brand/categorical from the
  // palette. Drives the non-split stroke/fill AND the card-tooltip swatch (the
  // line itself paints from a gradient, which can't be a swatch background).
  const solidColor = isSemantic
    ? netPositive
      ? CHART_POSITIVE
      : CHART_NEGATIVE
    : resolveSeriesColor(colorMode, 0);

  // Leading edge ("now"): the last row the subject series actually covers (its
  // line stops there mid-axis). The dot takes that point's OWN sign — not the
  // series net — so a profit line currently in the red reads red at the tip.
  const liveRow = liveDot
    ? [...rows].reverse().find((row) => Number.isFinite(Number(row[series.key])))
    : undefined;
  const liveColor =
    liveRow && isSemantic
      ? Number(liveRow[series.key]) >= 0
        ? CHART_POSITIVE
        : CHART_NEGATIVE
      : solidColor;

  const config = {
    [series.key]: { label: series.label, color: solidColor },
    ...(comparison
      ? { [comparison.key]: { label: comparison.label, color: CHART_COMPARISON } }
      : {}),
  } satisfies ChartConfig;

  const formatTooltip = (value: number | string, dataKey?: string): string =>
    valueFormatter(Number(value), dataKey === comparison?.key ? comparison?.format : series.format);

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto h-full w-full', className)}
      role="img"
      aria-label={ariaLabel ?? series.label}
    >
      <ComposedChart data={rows} margin={PLOT_MARGIN}>
        <defs>
          <linearGradient id={strokeId} x1="0" y1="0" x2="0" y2="1">
            {split ? (
              <>
                <stop offset={0} stopColor={CHART_POSITIVE} />
                <stop offset={offset} stopColor={CHART_POSITIVE} />
                <stop offset={offset} stopColor={CHART_NEGATIVE} />
                <stop offset={1} stopColor={CHART_NEGATIVE} />
              </>
            ) : (
              <stop offset={0} stopColor={solidColor} />
            )}
          </linearGradient>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            {split ? (
              <>
                <stop offset={0} stopColor={CHART_POSITIVE} stopOpacity={0.22} />
                <stop offset={offset} stopColor={CHART_POSITIVE} stopOpacity={0.02} />
                <stop offset={offset} stopColor={CHART_NEGATIVE} stopOpacity={0.02} />
                <stop offset={1} stopColor={CHART_NEGATIVE} stopOpacity={0.22} />
              </>
            ) : (
              <>
                <stop offset={0} stopColor={solidColor} stopOpacity={0.22} />
                <stop offset={1} stopColor={solidColor} stopOpacity={0} />
              </>
            )}
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray={GRID_DASH} />
        <XAxis dataKey={xKey} {...CHART_X_AXIS_PROPS} tickFormatter={xTickFormatter} />
        <YAxis {...CHART_Y_AXIS_PROPS} tickFormatter={formatAxis} />
        <ReferenceLine y={0} stroke={CHART_ZERO_LINE} />
        <ChartTooltip
          cursor={
            showCrosshair
              ? { stroke: 'var(--color-border-strong)', strokeDasharray: CURSOR_DASH }
              : false
          }
          content={
            <ChartTooltipContent
              variant={comparison ? 'card' : 'inverted'}
              valueFormatter={formatTooltip}
            />
          }
        />
        {variant === 'area' ? (
          <Area
            type="monotone"
            dataKey={series.key}
            baseValue={0}
            stroke={`url(#${strokeId})`}
            strokeWidth={2.2}
            fill={`url(#${fillId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
            isAnimationActive={false}
          />
        ) : (
          <Line
            type="monotone"
            dataKey={series.key}
            stroke={`url(#${strokeId})`}
            strokeWidth={2.2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
            isAnimationActive={false}
          />
        )}
        {/* Reference line drawn before the live dot so the "now" marker stays on top. */}
        {comparison ? (
          <Line
            type="monotone"
            dataKey={comparison.key}
            stroke={CHART_COMPARISON}
            strokeOpacity={COMPARISON_OPACITY}
            strokeWidth={1.5}
            strokeDasharray={COMPARISON_DASH}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 2, stroke: 'var(--color-card)' }}
            isAnimationActive={false}
            connectNulls
          />
        ) : null}
        {liveRow ? (
          <ReferenceDot
            x={liveRow[xKey]}
            y={Number(liveRow[series.key])}
            ifOverflow="visible"
            shape={(dotProps) => (
              <ChartLiveDot cx={dotProps.cx} cy={dotProps.cy} color={liveColor} />
            )}
          />
        ) : null}
      </ComposedChart>
    </ChartContainer>
  );
}
