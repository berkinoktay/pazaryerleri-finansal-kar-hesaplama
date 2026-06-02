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
  CHART_POSITIVE,
  CHART_ZERO_LINE,
  resolveSeriesColor,
  resolveValueColor,
} from './chart-colors';
import { useChartAxisFormatter, useChartValueFormatter } from './chart-format';
import {
  BAR_CATEGORY_GAP,
  BAR_CURSOR,
  BAR_RADIUS,
  ChartBar,
  roundedRectTop,
  type BarShape,
} from './chart-shapes';
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
 * bar rounds only its FREE end; the edge sitting on the zero baseline stays
 * square (`--radius-md`).
 *
 * STACKED (`series` is an array of `ChartSeries`) — the segments stack into one
 * connected bar (no gap) whose TOP cap is rounded (the base sits square on the
 * zero baseline),
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

// The grouped comparison bar rides translucent so it reads as a quiet backdrop.
const COMPARISON_FILL_OPACITY = 0.4;

/**
 * One stacked segment — connected (no gap). Only the TOP cap rounds its top
 * corners; every other segment (incl. the base sitting on the zero baseline) is
 * a flush square rect.
 */
function StackedSegment({
  x,
  y,
  width,
  height,
  fill,
  isTop,
}: BarShape & { isTop?: boolean }): React.ReactElement {
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
                shape={<StackedSegment isTop={index === seriesList.length - 1} />}
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
  if (colorMode === 'semantic') return resolveValueColor(value);
  if (colorMode === 'categorical') return resolveSeriesColor('categorical', index);
  return CHART_BRAND;
}

/** Representative swatch for the single-series card tooltip (semantic varies per bar). */
function singleSwatch(colorMode: ChartColorMode): string {
  if (colorMode === 'semantic') return CHART_POSITIVE;
  if (colorMode === 'brand') return CHART_BRAND;
  return resolveSeriesColor('categorical', 0);
}
