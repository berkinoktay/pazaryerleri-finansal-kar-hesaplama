'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Cell, Pie, PieChart } from 'recharts';

import { ChartContainer, ChartSwatch, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import { resolveSeriesColor } from './chart-colors';
import { useChartValueFormatter, type ChartFormatFn } from './chart-format';
import { ChartEmptyFrame } from './chart-states';
import type { ChartValueFormat } from './chart.types';

/**
 * Donut / share chart — the kit's part-to-whole archetype. A ring of qualitative
 * slices around a center total, with a side legend reading colour · label ·
 * value · %. For a breakdown where the SHARE is the story: gider dağılımı,
 * pazaryeri payı, kategori payı.
 *
 * Slices sort descending and colour from the qualitative palette (`--chart-1…6`);
 * rounded caps + a small `paddingAngle` separate them. The center shows the
 * formatted total (and an optional caption); hovering a slice shows its value +
 * share. The kit's first non-Cartesian chart — no axes — so it renders its own
 * ring-shaped empty frame. Wrap in `<ChartFrame chartKind="donut">`.
 *
 * @useWhen showing how a total splits into parts — a cost/expense breakdown, a
 *   marketplace or category share
 */
export interface DonutDatum {
  /** Slice label (a category / marketplace name). */
  label: string;
  value: number;
}

export interface DonutChartProps {
  data: ReadonlyArray<DonutDatum>;
  /** Value format for the center total, legend, and tooltip. Defaults to `currency`. */
  format?: ChartValueFormat;
  /** Caption under the center total (e.g. "Toplam Gider"). */
  centerLabel?: string;
  className?: string;
  ariaLabel?: string;
}

// Ring geometry — inner/outer radius as a fraction of the container, the gap
// between slices, and the rounded slice cap (mirrors --radius-sm).
const INNER_RADIUS = '60%';
const OUTER_RADIUS = '92%';
const PADDING_ANGLE = 2;
const CORNER_RADIUS = 6;

interface DonutSlice {
  label: string;
  value: number;
  fill: string;
  percent: number;
}

interface DonutTooltipProps {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; payload?: DonutSlice }>;
  format: ChartValueFormat;
  valueFormatter: ChartFormatFn;
}

/** Hovered-slice readout — colour · label · value · share, on the card surface. */
function DonutTooltip({
  active,
  payload,
  format,
  valueFormatter,
}: DonutTooltipProps): React.ReactElement | null {
  if (!active || !payload?.length) return null;
  const slice = payload[0]?.payload;
  if (!slice) return null;
  return (
    <div className="border-border bg-popover text-popover-foreground px-sm py-xs gap-xs text-2xs flex items-center rounded-md border shadow-md">
      <ChartSwatch color={slice.fill} />
      <span className="text-muted-foreground">{slice.label}</span>
      <span className="text-foreground font-medium tabular-nums">
        {valueFormatter(slice.value, format)}
      </span>
      <span className="text-muted-foreground tabular-nums">· %{slice.percent}</span>
    </div>
  );
}

export function DonutChart({
  data,
  format = 'currency',
  centerLabel,
  className,
  ariaLabel,
}: DonutChartProps): React.ReactElement {
  const t = useTranslations('common.chart');
  const valueFormatter = useChartValueFormatter();
  const label = ariaLabel ?? t('a11y.chart');

  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  // Empty (no data, or every slice zero so the ring can't draw): the kit's own
  // ring-shaped empty frame.
  if (data.length === 0 || total <= 0) {
    return <ChartEmptyFrame shape="donut" yLabels={[]} ariaLabel={label} className={className} />;
  }

  const slices: DonutSlice[] = [...data]
    .sort((a, b) => b.value - a.value)
    .map((slice, index) => ({
      label: slice.label,
      value: slice.value,
      fill: resolveSeriesColor('categorical', index),
      percent: Math.round((slice.value / total) * 100),
    }));

  // Slices paint via <Cell> (not ChartConfig --color vars), so config is empty.
  const config: ChartConfig = {};

  return (
    <div
      className={cn('gap-xl flex h-full items-center justify-center', className)}
      role="img"
      aria-label={label}
    >
      <div className="relative aspect-square h-full max-h-full shrink-0 self-stretch">
        <ChartContainer config={config} className="aspect-auto h-full w-full">
          <PieChart>
            <ChartTooltip
              content={<DonutTooltip format={format} valueFormatter={valueFormatter} />}
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={INNER_RADIUS}
              outerRadius={OUTER_RADIUS}
              paddingAngle={PADDING_ANGLE}
              cornerRadius={CORNER_RADIUS}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                // runtime-dynamic: slice fill is the palette color
                <Cell key={slice.label} fill={slice.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {/* Center total — overlaid on the ring's hole. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-foreground text-xl font-semibold tracking-tight tabular-nums">
            {valueFormatter(total, format)}
          </span>
          {centerLabel ? (
            <span className="text-2xs text-muted-foreground">{centerLabel}</span>
          ) : null}
        </div>
      </div>

      {/* Legend — a compact aligned grid (swatch + label · value · share) that
          hugs the ring instead of stretching its values to the card edge. */}
      <div
        className="gap-x-lg gap-y-sm grid items-center text-sm"
        // structural: [swatch + label] · value · share columns
        style={{ gridTemplateColumns: 'auto auto auto' }}
      >
        {slices.map((slice) => (
          <React.Fragment key={slice.label}>
            <span className="gap-xs flex items-center">
              <ChartSwatch color={slice.fill} />
              <span className="text-muted-foreground">{slice.label}</span>
            </span>
            <span className="text-foreground text-right font-medium tabular-nums">
              {valueFormatter(slice.value, format)}
            </span>
            <span className="text-muted-foreground text-right tabular-nums">%{slice.percent}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
