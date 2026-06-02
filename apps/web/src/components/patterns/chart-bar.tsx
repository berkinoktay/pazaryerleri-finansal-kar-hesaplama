'use client';

import * as React from 'react';
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import {
  CHART_X_AXIS_PROPS,
  CHART_Y_AXIS_PROPS,
  GRID_DASH,
  PLOT_MARGIN,
  chartEmptyYLabels,
} from './chart-cartesian';
import {
  CHART_BRAND,
  CHART_COMPARISON,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  CHART_ZERO_LINE,
  resolveSeriesColor,
} from './chart-colors';
import { useChartAxisFormatter, useChartValueFormatter } from './chart-format';
import { ChartEmptyFrame } from './chart-states';
import type { ChartColorMode, ChartDatum, ChartSeries } from './chart.types';

/**
 * Vertical bar / column chart — the kit's discrete-category archetype (a
 * horizontal bar is the separate Ranking archetype).
 *
 * SINGLE series (`series` is one `ChartSeries`) + three coloring modes:
 * - `semantic` (default) — each bar by its OWN sign (kâr yeşil / zarar kırmızı).
 *   The bar analogue of LineChart's zero-split.
 * - `brand` — every bar the brand color (neutral count).
 * - `categorical` — the palette per bar (a breakdown).
 * Pass `comparison` for a muted grouped "Dün" bar beside each subject bar. Every
 * single bar is a rounded rectangle (all four corners, `--radius-md`).
 *
 * STACKED (`series` is an array of `ChartSeries`) — the segments stack into one
 * connected bar (no gap) whose OUTER corners are rounded (top cap + base),
 * coloured from the qualitative palette, with a bottom legend mapping colour →
 * series. For a composition (e.g. gelir = net kâr + komisyon + kargo).
 *
 * Hover highlights the whole column with a faint background. Wrap in
 * `<ChartFrame>` for chrome + states.
 *
 * @useWhen plotting a value across discrete categories — daily P&L (semantic),
 *   a count (`brand`), a breakdown (`categorical`), or a composition (stacked)
 */
export interface BarChartProps {
  data: ReadonlyArray<ChartDatum>;
  xKey: string;
  /** One series (single/grouped bar) or several (stacked segments + legend). */
  series: ChartSeries | ReadonlyArray<ChartSeries>;
  /** Optional muted grouped "Dün" comparison bar (single-series only). */
  comparison?: ChartSeries;
  /** Single-series color resolution. Defaults to `semantic` (per-bar sign). */
  colorMode?: ChartColorMode;
  xTickFormatter?: (value: string | number) => string;
  className?: string;
  ariaLabel?: string;
}

// Corner radius (px) — mirrors --radius-md. Single bars round all four corners;
// a stacked bar rounds its outer corners (top of the top cap, bottom of the base).
const BAR_RADIUS = 10;
// Hovered-column highlight — a faint full-height fill spanning the category band
// behind the bars, the bar-family cursor (Line uses a dashed crosshair instead).
const BAR_CURSOR = { fill: 'var(--color-muted-foreground)', fillOpacity: 0.12, radius: 6 } as const;
// Tighter category gap than recharts' "10%" default — more compact columns.
const BAR_CATEGORY_GAP = '8%';
// The grouped comparison bar rides translucent so it reads as a quiet backdrop.
const COMPARISON_FILL_OPACITY = 0.4;

interface BarShape {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  index?: number;
  payload?: ChartDatum;
}

/**
 * Rounded-rect path with all four corners rounded by `r` (clamped). Handles a
 * negative `h` (recharts hands negative bars a negative height) by normalizing
 * to the top edge first — otherwise the clamp collapses the radius to 0 and the
 * sub-zero bar renders square.
 */
function roundedRectAll(x: number, y: number, w: number, h: number, r: number): string {
  const top = h >= 0 ? y : y + h;
  const ht = Math.abs(h);
  const rad = Math.max(0, Math.min(r, w / 2, ht / 2));
  return `M${x + rad},${top} L${x + w - rad},${top} Q${x + w},${top} ${x + w},${top + rad} L${x + w},${top + ht - rad} Q${x + w},${top + ht} ${x + w - rad},${top + ht} L${x + rad},${top + ht} Q${x},${top + ht} ${x},${top + ht - rad} L${x},${top + rad} Q${x},${top} ${x + rad},${top} Z`;
}

/** Rounded-rect path with only the top two corners rounded (stacked top cap). */
function roundedRectTop(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rad} Q${x},${y} ${x + rad},${y} L${x + w - rad},${y} Q${x + w},${y} ${x + w},${y + rad} L${x + w},${y + h} Z`;
}

/** Rounded-rect path with only the bottom two corners rounded (stacked base). */
function roundedRectBottom(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y} L${x + w},${y} L${x + w},${y + h - rad} Q${x + w},${y + h} ${x + w - rad},${y + h} L${x + rad},${y + h} Q${x},${y + h} ${x},${y + h - rad} L${x},${y} Z`;
}

/** Single rounded bar (all corners) — fill is data-driven. */
function ChartBar({
  x,
  y,
  width,
  height,
  fill,
  fillOpacity,
}: BarShape & { fill: string; fillOpacity?: number }): React.ReactElement {
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return <g />;
  return (
    // runtime-dynamic: bar fill is the value's resolved color
    <path
      d={roundedRectAll(x, y, width, height, BAR_RADIUS)}
      fill={fill}
      fillOpacity={fillOpacity}
    />
  );
}

/** One stacked segment — connected (no gap); outer corners (top cap / base) rounded. */
function StackedSegment({
  x,
  y,
  width,
  height,
  fill,
  isTop,
  isBottom,
}: BarShape & { isTop?: boolean; isBottom?: boolean }): React.ReactElement {
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    height <= 0
  )
    return <g />;
  // runtime-dynamic: segment fill is the series palette color (recharts-injected)
  if (isTop) return <path d={roundedRectTop(x, y, width, height, BAR_RADIUS)} fill={fill} />;
  if (isBottom) return <path d={roundedRectBottom(x, y, width, height, BAR_RADIUS)} fill={fill} />;
  return <rect x={x} y={y} width={width} height={height} fill={fill} />;
}

export function BarChart({
  data,
  xKey,
  series,
  comparison,
  colorMode = 'semantic',
  xTickFormatter,
  className,
  ariaLabel,
}: BarChartProps): React.ReactElement {
  const valueFormatter = useChartValueFormatter();
  const axisFormatter = useChartAxisFormatter();

  const seriesList = Array.isArray(series) ? series : [series];
  const isStacked = seriesList.length > 1;
  const primary = seriesList[0];
  const formatAxis = (value: number | string): string =>
    axisFormatter(Number(value), primary.format);

  const displayKeys = isStacked
    ? seriesList.map((s) => s.key)
    : comparison
      ? [primary.key, comparison.key]
      : [primary.key];
  const hasData = data.some((row) => displayKeys.some((key) => Number.isFinite(Number(row[key]))));

  // Empty: recharts can't draw axes from an empty array — render the kit's own
  // frame (real y labels + dashed gridlines + bar placeholders); ChartFrame
  // overlays the hint.
  if (!hasData) {
    return (
      <ChartEmptyFrame
        shape="bar"
        yLabels={chartEmptyYLabels(formatAxis)}
        ariaLabel={ariaLabel ?? primary.label}
        className={className}
      />
    );
  }

  // Mutable copy — recharts' `data` prop type isn't readonly.
  const rows = data.slice();

  const formatTooltip = (value: number | string, dataKey?: string): string => {
    const match =
      seriesList.find((s) => s.key === dataKey) ??
      (dataKey === comparison?.key ? comparison : primary);
    return valueFormatter(Number(value), match?.format);
  };

  const config: ChartConfig = isStacked
    ? Object.fromEntries(
        seriesList.map((s, index) => [
          s.key,
          { label: s.label, color: resolveSeriesColor('categorical', index) },
        ]),
      )
    : {
        [primary.key]: { label: primary.label, color: singleSwatch(colorMode) },
        ...(comparison
          ? { [comparison.key]: { label: comparison.label, color: CHART_COMPARISON } }
          : {}),
      };

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto h-full w-full', className)}
      role="img"
      aria-label={ariaLabel ?? primary.label}
    >
      <RechartsBarChart data={rows} margin={PLOT_MARGIN} barCategoryGap={BAR_CATEGORY_GAP}>
        <CartesianGrid vertical={false} strokeDasharray={GRID_DASH} />
        <XAxis dataKey={xKey} {...CHART_X_AXIS_PROPS} tickFormatter={xTickFormatter} />
        <YAxis {...CHART_Y_AXIS_PROPS} tickFormatter={formatAxis} />
        <ReferenceLine y={0} stroke={CHART_ZERO_LINE} />
        <ChartTooltip
          cursor={BAR_CURSOR}
          content={
            <ChartTooltipContent
              variant={isStacked || comparison ? 'card' : 'inverted'}
              valueFormatter={formatTooltip}
            />
          }
        />

        {isStacked ? (
          <>
            {seriesList.map((s, index) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="stack"
                fill={resolveSeriesColor('categorical', index)}
                isAnimationActive={false}
                shape={
                  <StackedSegment isTop={index === seriesList.length - 1} isBottom={index === 0} />
                }
              />
            ))}
            <ChartLegend content={<ChartLegendContent />} />
          </>
        ) : (
          <>
            <Bar
              dataKey={primary.key}
              isAnimationActive={false}
              shape={(props: BarShape) => (
                <ChartBar
                  {...props}
                  fill={fillFor(colorMode, Number(props.payload?.[primary.key]), props.index ?? 0)}
                />
              )}
            />
            {comparison ? (
              <Bar
                dataKey={comparison.key}
                isAnimationActive={false}
                shape={(props: BarShape) => (
                  <ChartBar
                    {...props}
                    fill={CHART_COMPARISON}
                    fillOpacity={COMPARISON_FILL_OPACITY}
                  />
                )}
              />
            ) : null}
          </>
        )}
      </RechartsBarChart>
    </ChartContainer>
  );
}

/** Per-bar fill for a single series, by color mode + value sign + index. */
function fillFor(colorMode: ChartColorMode, value: number, index: number): string {
  if (colorMode === 'semantic') return value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE;
  if (colorMode === 'categorical') return resolveSeriesColor('categorical', index);
  return CHART_BRAND;
}

/** Representative swatch for the single-series card tooltip (semantic varies per bar). */
function singleSwatch(colorMode: ChartColorMode): string {
  if (colorMode === 'semantic') return CHART_POSITIVE;
  if (colorMode === 'brand') return CHART_BRAND;
  return resolveSeriesColor('categorical', 0);
}
