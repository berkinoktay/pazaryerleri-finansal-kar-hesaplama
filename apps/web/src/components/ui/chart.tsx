'use client';

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';

import { cn } from '@/lib/utils';

/**
 * Minimal shadcn-style chart wrapper around recharts.
 *
 * Exposes chart colors as CSS custom properties on the container via
 * inline style (no <style> injection), so Recharts children can reference
 * them via `var(--color-<key>)` without hardcoding hex values. This is
 * what keeps charts theme-correct in dark mode without per-series
 * conditional logic — see `apps/web/CLAUDE.md` "Dark-mode discipline"
 * rule #3 for the rationale (raw `--chart-N` values are dark-mode traps;
 * always wire through ChartConfig + `--color-<key>`).
 *
 * @useWhen rendering a recharts chart whose series colors must swap correctly in dark mode (always pair with ChartConfig keyed by series name)
 */

// Positive first-render size so recharts' ResponsiveContainer doesn't start at
// its default {-1,-1} — that logs a "width/height(-1)" warning and flashes
// blank when a chart mounts in place of a skeleton. The ResizeObserver swaps in
// the real size (from the sized parent) on the next frame.
const CHART_INITIAL_DIMENSION = { width: 320, height: 200 };

export type ChartConfig = Record<
  string,
  {
    label: string;
    color?: string;
  }
>;

interface ChartContextProps {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useChart(): ChartContextProps {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within <ChartContainer>');
  return context;
}

function configToCssVars(config: ChartConfig): React.CSSProperties {
  const vars: Record<string, string> = {};
  for (const [key, entry] of Object.entries(config)) {
    if (entry.color) vars[`--color-${key}`] = entry.color;
  }
  return vars as React.CSSProperties;
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
  }
>(({ className, children, config, style, ...props }, ref) => {
  const cssVars = React.useMemo(() => configToCssVars(config), [config]);
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        // runtime-dynamic: chart color palette is config-driven
        style={{ ...cssVars, ...style }}
        className={cn(
          'text-2xs flex aspect-video justify-center',
          '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-axis-tick_text]:tabular-nums',
          // Grid reads from the chart-system token so it stays a hairline in
          // light but lifts to a visible value in dark (see --chart-grid).
          '[&_.recharts-cartesian-grid_line]:stroke-chart-grid',
          // Cursor stroke/fill is set per-chart on the `cursor` prop (a dashed
          // line for Line, a filled column for Bar) — not forced here, so the
          // bar column isn't outlined.
          '[&_.recharts-layer]:outline-none',
          '[&_.recharts-sector]:outline-none',
          '[&_.recharts-surface]:outline-none',
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = 'ChartContainer';

export const ChartTooltip = RechartsPrimitive.Tooltip;

interface ChartTooltipPayloadEntry {
  name: string;
  value: number | string;
  color?: string;
  dataKey?: string;
}

// recharts injects `active` / `payload` / `label` into the element passed as
// `<Tooltip content={...}>`. We type only what we read and DELIBERATELY do not
// spread the rest onto the DOM — recharts also injects ~15 internal props
// (contentStyle, wrapperStyle, isAnimationActive, allowEscapeViewBox, …) that
// would otherwise hit the <div> and trigger "React does not recognize the prop"
// warnings.
interface ChartTooltipContentProps {
  active?: boolean;
  payload?: Array<ChartTooltipPayloadEntry>;
  label?: string;
  hideLabel?: boolean;
  /**
   * `card` (default) — popover-style card, one swatch+label+value row per
   * series; for multi-series / categorical charts.
   * `inverted` — a compact high-contrast bar on the `--foreground` surface
   * showing label + value inline; the D-language crosshair readout for a
   * single-series time chart.
   */
  variant?: 'card' | 'inverted';
  /**
   * Formats each entry's value (e.g. ₺ via the series format). When omitted
   * the raw value is shown — keeps the primitive usable without a formatter.
   */
  valueFormatter?: (value: number | string, dataKey?: string) => string;
  className?: string;
}

export const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  (
    { active, payload, label, hideLabel = false, variant = 'card', valueFormatter, className },
    ref,
  ) => {
    const { config } = useChart();
    if (!active || !payload?.length) return null;

    const formatValue = (entry: ChartTooltipPayloadEntry): string =>
      valueFormatter ? valueFormatter(entry.value, entry.dataKey) : String(entry.value);

    if (variant === 'inverted') {
      return (
        <div
          ref={ref}
          className={cn(
            'bg-foreground text-background px-sm py-2xs gap-xs text-2xs flex items-center rounded-md font-medium shadow-md',
            className,
          )}
        >
          {!hideLabel && label ? <span className="opacity-70">{label}</span> : null}
          {payload.map((entry) => (
            <span key={entry.name} className="font-semibold tabular-nums">
              {formatValue(entry)}
            </span>
          ))}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          'border-border bg-popover px-sm py-xs text-2xs text-popover-foreground rounded-md border shadow-md',
          className,
        )}
      >
        {!hideLabel && label ? (
          <div className="mb-3xs text-foreground font-medium">{label}</div>
        ) : null}
        <div className="gap-3xs flex flex-col">
          {payload.map((entry) => {
            const itemConfig = entry.dataKey ? config[entry.dataKey] : undefined;
            return (
              <div key={entry.name} className="gap-xs flex items-center">
                <span
                  className="size-xs shrink-0 rounded-sm"
                  // runtime-dynamic: chart entry color is data-driven
                  style={{
                    backgroundColor: itemConfig?.color ?? entry.color ?? 'var(--muted-foreground)',
                  }}
                />
                <span className="text-muted-foreground">{itemConfig?.label ?? entry.name}</span>
                <span className="text-foreground ml-auto tabular-nums">{formatValue(entry)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = 'ChartTooltipContent';

export const ChartLegend = RechartsPrimitive.Legend;

interface ChartLegendContentProps {
  payload?: Array<{
    value: string;
    color?: string;
    dataKey?: string;
  }>;
  className?: string;
}

export const ChartLegendContent = React.forwardRef<HTMLDivElement, ChartLegendContentProps>(
  ({ payload, className }, ref) => {
    const { config } = useChart();
    if (!payload?.length) return null;
    return (
      <div
        ref={ref}
        className={cn('gap-md pt-md flex flex-wrap items-center justify-center', className)}
      >
        {payload.map((entry) => {
          const itemConfig = entry.dataKey ? config[String(entry.dataKey)] : undefined;
          return (
            <div
              key={entry.value}
              className="gap-xs text-2xs text-muted-foreground flex items-center"
            >
              <span
                className="size-2 shrink-0 rounded-sm"
                // runtime-dynamic: legend color is data-driven
                style={{
                  backgroundColor: itemConfig?.color ?? entry.color ?? 'var(--muted-foreground)',
                }}
              />
              <span>{itemConfig?.label ?? entry.value}</span>
            </div>
          );
        })}
      </div>
    );
  },
);
ChartLegendContent.displayName = 'ChartLegendContent';
