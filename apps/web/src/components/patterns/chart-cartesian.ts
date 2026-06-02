/**
 * Shared Cartesian chart scaffolding — the kit's house axis / grid / cursor
 * defaults, extracted at the 2nd Cartesian consumer (BarChart) so that Line,
 * Bar, Combo, and Waterfall don't each copy them. recharts introspects its axis
 * children BY TYPE (it scans for `XAxis`/`YAxis`), so these can't be wrapped in
 * custom components — instead we export spreadable default prop objects plus the
 * shared constants. Ranking (horizontal) and Donut (no axes) deliberately don't
 * consume this.
 */

/** Plot inset so caps / dots / the leading edge aren't clipped at the frame edge. */
export const PLOT_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;
const X_AXIS_PADDING = { left: 8, right: 8 } as const;

// Dash rhythms (SVG stroke-dasharray): the grid is the faintest (short dash,
// wide gap); the hover crosshair a step up. The comparison-line dash is
// line-family and stays local to chart-line.
export const GRID_DASH = '2 4';
export const CURSOR_DASH = '4 4';

/**
 * Default XAxis props (category / time axis). Spread onto `<XAxis>`, then add
 * `dataKey` and `tickFormatter`. `tick` defaults to shown.
 */
export const CHART_X_AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 12,
  minTickGap: 28,
  interval: 'preserveStartEnd' as const,
  padding: X_AXIS_PADDING,
};

/**
 * Default YAxis props (value axis). Spread onto `<YAxis>`, then add
 * `tickFormatter` (and `domain`/`ticks` only when forcing an empty scale).
 */
export const CHART_Y_AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  width: 56,
  tickMargin: 10,
  tickCount: 5,
};

// Neutral 0-anchored tick scale for an empty Cartesian chart's y-axis labels.
const EMPTY_Y_TICKS = [0, 25, 50, 75, 100];

/**
 * Representative top→bottom y-axis labels for the empty frame (`ChartEmptyFrame`),
 * formatted through the series' value format. recharts can't draw axes from an
 * empty data array, so each Cartesian archetype hands these to the empty frame.
 */
export function chartEmptyYLabels(format: (value: number) => string): string[] {
  return [...EMPTY_Y_TICKS].reverse().map(format);
}
