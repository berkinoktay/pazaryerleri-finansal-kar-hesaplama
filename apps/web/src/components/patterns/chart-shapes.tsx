/**
 * Shared chart-mark visual language — the constants and SVG geometry that make a
 * mark read identically across archetypes. Bars: the corner radius, the hovered-
 * column cursor, the category gap, the rounded-rect cap paths, and the sign-aware
 * `ChartBar` shape (extracted at the 2nd bar consumer, ComboChart, so BarChart
 * and ComboChart paint identical bars). Lines: the stroke width + active-dot
 * styling shared by LineChart and ComboChart so a combo line reads identically to
 * a standalone one. Pure constants / SVG geometry — no recharts import, no React
 * state.
 *
 * The house rule every bar in the kit follows: round only the FREE end (the
 * value tip), leave the edge on the zero baseline square. A bar above zero caps
 * its top; a sub-zero bar (recharts hands it a negative height) caps its bottom.
 */

import type { ReactElement } from 'react';

import type { ChartDatum } from './chart.types';

/** Corner radius (px) for a bar's free end — mirrors --radius-md. */
export const BAR_RADIUS = 10;

/**
 * Hovered-column highlight — a faint full-height fill spanning the category band
 * behind the bars, the bar-family cursor (Line uses a dashed crosshair instead).
 */
export const BAR_CURSOR = {
  fill: 'var(--color-muted-foreground)',
  fillOpacity: 0.12,
  radius: 6,
} as const;

/** Tighter category gap than recharts' "10%" default — more compact columns. */
export const BAR_CATEGORY_GAP = '8%';

/** Line stroke width (px) — shared so a ComboChart line matches a standalone LineChart. */
export const LINE_STROKE_WIDTH = 2.2;

/** Hovered-point dot for a line — a card-ringed core, shared by Line + Combo. */
export const LINE_ACTIVE_DOT = { r: 4, strokeWidth: 2, stroke: 'var(--color-card)' } as const;

/** The geometry recharts injects into a `<Bar shape>` render prop. */
export interface BarShape {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  index?: number;
  payload?: ChartDatum;
}

/** Rounded-rect path with only the top two corners rounded (a bar capping upward). */
export function roundedRectTop(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rad} Q${x},${y} ${x + rad},${y} L${x + w - rad},${y} Q${x + w},${y} ${x + w},${y + rad} L${x + w},${y + h} Z`;
}

/** Rounded-rect path with only the bottom two corners rounded (a sub-zero bar capping downward). */
export function roundedRectBottom(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y} L${x + w},${y} L${x + w},${y + h - rad} Q${x + w},${y + h} ${x + w - rad},${y + h} L${x + rad},${y + h} Q${x},${y + h} ${x},${y + h - rad} L${x},${y} Z`;
}

/**
 * A single bar — rounds only the free end (the value tip), leaving the edge on
 * the zero baseline square. recharts hands a sub-zero bar a negative height, so
 * we normalize to (top, |h|) and pick the cap by the height's sign. Used by
 * BarChart (single / grouped / comparison) and ComboChart (grouped bars).
 */
export function ChartBar({
  x,
  y,
  width,
  height,
  fill,
  fillOpacity,
}: BarShape & { fill: string; fillOpacity?: number }): ReactElement {
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return <g />;
  const top = height >= 0 ? y : y + height;
  const absHeight = Math.abs(height);
  const path =
    height >= 0
      ? roundedRectTop(x, top, width, absHeight, BAR_RADIUS)
      : roundedRectBottom(x, top, width, absHeight, BAR_RADIUS);
  // runtime-dynamic: bar fill is the series / value resolved color
  return <path d={path} fill={fill} fillOpacity={fillOpacity} />;
}
