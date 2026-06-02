'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';

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
import { CHART_ZERO_LINE, resolveSeriesColor } from './chart-colors';
import { useChartAxisFormatter, useChartValueFormatter } from './chart-format';
import {
  BAR_CATEGORY_GAP,
  BAR_CURSOR,
  ChartBar,
  LINE_ACTIVE_DOT,
  LINE_STROKE_WIDTH,
  type BarShape,
} from './chart-shapes';
import { ChartEmptyFrame } from './chart-states';
import type { ChartDatum, ChartSeries } from './chart.types';

/**
 * Combo (bar + line, dual-axis) — the kit's "magnitude vs. rate" archetype. Bars
 * carry the absolute figure on the LEFT axis (ciro, sipariş tutarı, hacim); lines
 * carry a rate / ratio on the RIGHT axis (marj %, dönüşüm %, iade oranı). The two
 * scales let a value and the rate it produces share one frame without one
 * flattening the other.
 *
 * Bars round only their free end (the shared bar-family `ChartBar` shape — a
 * sub-zero bar caps downward); a line rides on top, stroke-only. Every series
 * takes the next qualitative palette colour (`--chart-1…6`) across bars THEN
 * lines, and a bottom legend maps colour → series. The tooltip is the multi-row
 * card, each row formatted by its own series (₺ for a bar, % for a line).
 *
 * With no data it renders its OWN empty frame (faint columns + a faint line);
 * recharts can't draw axes from an empty array. Wrap in
 * `<ChartFrame chartKind="combo">` for chrome + states.
 *
 * @useWhen showing an absolute value and the rate it drives together — ciro +
 *   marj %, sipariş tutarı + dönüşüm %, hacim + iade oranı
 */
export interface ComboChartProps {
  data: ReadonlyArray<ChartDatum>;
  xKey: string;
  /** Bar series — the LEFT (magnitude) axis. */
  bars: ReadonlyArray<ChartSeries>;
  /** Line series — the RIGHT (rate / ratio) axis. */
  lines: ReadonlyArray<ChartSeries>;
  className?: string;
  ariaLabel?: string;
}

export function ComboChart({
  data,
  xKey,
  bars,
  lines,
  className,
  ariaLabel,
}: ComboChartProps): React.ReactElement {
  const t = useTranslations('common.chart');
  const valueFormatter = useChartValueFormatter();
  const axisFormatter = useChartAxisFormatter();
  const label = ariaLabel ?? t('a11y.chart');

  const hasBars = bars.length > 0;
  const hasLines = lines.length > 0;
  // Lines normally live on the right axis; with no bars (degenerate combo) they
  // fall back to the single left axis so they're never orphaned without a scale.
  const linesAxisId = hasBars ? 'right' : 'left';
  // The left axis's value format drives the empty-frame y-labels too.
  const leftFormat = hasBars ? bars[0].format : lines[0]?.format;
  const formatLeftAxis = (value: number | string): string =>
    axisFormatter(Number(value), leftFormat);
  const formatRightAxis = (value: number | string): string =>
    axisFormatter(Number(value), lines[0]?.format);

  // Every series, bars THEN lines, so palette colours assign in render order.
  const allSeries = [...bars, ...lines];
  const colorFor = (key: string): string =>
    resolveSeriesColor(
      'categorical',
      allSeries.findIndex((s) => s.key === key),
    );

  const hasData = data.some((row) => allSeries.some((s) => Number.isFinite(Number(row[s.key]))));

  // Empty: recharts can't draw axes from an empty array — render the kit's own
  // combo frame (faint columns + faint line); ChartFrame overlays the hint.
  if (!hasData || allSeries.length === 0) {
    return (
      <ChartEmptyFrame
        shape="combo"
        yLabels={chartEmptyYLabels(formatLeftAxis)}
        ariaLabel={label}
        className={className}
      />
    );
  }

  // Mutable copy — recharts' `data` prop type isn't readonly.
  const rows = data.slice();

  const config: ChartConfig = Object.fromEntries(
    allSeries.map((s) => [s.key, { label: s.label, color: colorFor(s.key) }]),
  );

  const formatTooltip = (value: number | string, dataKey?: string): string => {
    const match = allSeries.find((s) => s.key === dataKey);
    return valueFormatter(Number(value), match?.format);
  };

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto h-full w-full', className)}
      role="img"
      aria-label={label}
    >
      <ComposedChart data={rows} margin={PLOT_MARGIN} barCategoryGap={BAR_CATEGORY_GAP}>
        <CartesianGrid yAxisId="left" vertical={false} strokeDasharray={GRID_DASH} />
        <XAxis dataKey={xKey} {...CHART_X_AXIS_PROPS} />
        {/* Left (magnitude) axis — formatLeftAxis already falls back to the line
            format in the degenerate no-bars case, so one axis serves both. */}
        <YAxis
          yAxisId="left"
          orientation="left"
          {...CHART_Y_AXIS_PROPS}
          tickFormatter={formatLeftAxis}
        />
        {hasBars && hasLines ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...CHART_Y_AXIS_PROPS}
            tickFormatter={formatRightAxis}
          />
        ) : null}
        <ReferenceLine yAxisId="left" y={0} stroke={CHART_ZERO_LINE} />
        <ChartTooltip
          cursor={BAR_CURSOR}
          content={<ChartTooltipContent variant="card" valueFormatter={formatTooltip} />}
        />

        {/* Bars first so the line rides on top. */}
        {bars.map((s) => (
          <Bar
            key={s.key}
            yAxisId="left"
            dataKey={s.key}
            name={s.label}
            isAnimationActive={false}
            shape={(props: BarShape) => <ChartBar {...props} fill={colorFor(s.key)} />}
          />
        ))}
        {lines.map((s) => (
          <Line
            key={s.key}
            yAxisId={linesAxisId}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={colorFor(s.key)}
            strokeWidth={LINE_STROKE_WIDTH}
            dot={false}
            activeDot={LINE_ACTIVE_DOT}
            isAnimationActive={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </ComposedChart>
    </ChartContainer>
  );
}
