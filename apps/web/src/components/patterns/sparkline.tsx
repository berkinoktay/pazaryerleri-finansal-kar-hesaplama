'use client';

import * as React from 'react';
import { Area, AreaChart, Line, LineChart, ResponsiveContainer } from 'recharts';

import { cn } from '@/lib/utils';

/**
 * Inline trend microchart — designed to fit inside a KpiTile, table
 * cell, or row summary. Renders a tight area (default) or line chart
 * over a small numeric series with no axes, gridlines, or tooltips.
 * The chart is the visual; the surrounding label / value carries the
 * exact numbers.
 *
 * Tone-driven color uses the same semantic vocabulary as TrendDelta
 * and Badge — `success`, `warning`, `destructive`, `info`, `neutral`
 * — so a sparkline trailing a positive metric reads green and a
 * declining cost metric reads red without per-call styling.
 *
 * Recharts is the underlying engine (already on the project for
 * dashboard charts). Sparkline wraps it so callers don't re-derive
 * the dataset shape, the gradient definitions, or the responsive
 * container per use.
 *
 * @useWhen showing a tight inline trend microchart paired with a numeric value (use the full Chart primitive for axis-bearing dashboard charts; use TrendDelta for a single-period delta chip)
 */

export type SparklineTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info';
export type SparklineVariant = 'area' | 'line';

export interface SparklinePoint {
  /** Y-axis numeric value. */
  value: number;
  /** Optional X-axis label / key. Not rendered visually; useful as a stable React key. */
  label?: string | number;
}

export interface SparklineProps {
  /**
   * Series data — either a flat array of numbers (X = index) or an
   * array of `{ value, label? }` points. Empty arrays render an
   * empty placeholder.
   */
  data: number[] | SparklinePoint[];
  /** Color tone for the line/area. Defaults to `'neutral'`. */
  tone?: SparklineTone;
  /** `area` (default) renders with a gradient fill; `line` is stroke-only. */
  variant?: SparklineVariant;
  /** Width in px. Defaults to `80`. */
  width?: number;
  /** Height in px. Defaults to `24`. */
  height?: number;
  /** Stroke thickness. Defaults to `1.5`. */
  strokeWidth?: number;
  /**
   * Localized aria-label. Sparkline is decorative when paired with a
   * numeric label; pass an explicit aria-label only when the chart
   * is the sole signal (rare).
   */
  ariaLabel?: string;
  className?: string;
}

const TONE_COLOR: Record<SparklineTone, string> = {
  neutral: 'var(--muted-foreground)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  destructive: 'var(--destructive)',
  info: 'var(--info)',
};

function normalizeData(data: number[] | SparklinePoint[]): { value: number }[] {
  if (data.length === 0) return [];
  if (typeof data[0] === 'number') {
    return (data as number[]).map((value) => ({ value }));
  }
  return data as SparklinePoint[];
}

export function Sparkline({
  data,
  tone = 'neutral',
  variant = 'area',
  width = 80,
  height = 24,
  strokeWidth = 1.5,
  ariaLabel,
  className,
}: SparklineProps): React.ReactElement {
  const series = React.useMemo(() => normalizeData(data), [data]);
  const color = TONE_COLOR[tone];
  // Stable gradient id per render so multiple Sparklines on the same
  // page don't collide on the SVG <defs> id space.
  const gradientId = React.useId();

  if (series.length === 0) {
    return (
      <div
        role={ariaLabel !== undefined ? 'img' : 'presentation'}
        aria-label={ariaLabel}
        // runtime-dynamic: width/height are caller-driven sizing props,
        // not a token-system concern; expose as inline style so the
        // chart container collapses to the requested footprint
        style={{ width, height }}
        className={cn('bg-muted/30 rounded-sm', className)}
      />
    );
  }

  return (
    <div
      role={ariaLabel !== undefined ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      // runtime-dynamic: width/height are caller-driven sizing props
      style={{ width, height }}
      className={cn('inline-block', className)}
    >
      <ResponsiveContainer width="100%" height="100%">
        {variant === 'area' ? (
          <AreaChart data={series} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={strokeWidth}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        ) : (
          <LineChart data={series} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={strokeWidth}
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
