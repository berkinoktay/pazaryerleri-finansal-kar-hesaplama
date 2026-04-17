'use client';

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';

import { cn } from '@/lib/utils';

/**
 * Minimal shadcn-style chart wrapper around recharts.
 *
 * Exposes chart colors as CSS custom properties on the container via
 * inline style (no <style> injection), so Recharts children can reference
 * them via `var(--color-<key>)` without hardcoding hex values.
 */

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
          '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
          '[&_.recharts-cartesian-grid_line]:stroke-border',
          '[&_.recharts-tooltip-cursor]:stroke-border',
          '[&_.recharts-layer]:outline-none',
          '[&_.recharts-sector]:outline-none',
          '[&_.recharts-surface]:outline-none',
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = 'ChartContainer';

export const ChartTooltip = RechartsPrimitive.Tooltip;

interface ChartTooltipContentProps extends React.ComponentProps<'div'> {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | string;
    color?: string;
    dataKey?: string;
  }>;
  label?: string;
  hideLabel?: boolean;
}

export const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  ({ active, payload, label, hideLabel = false, className, ...props }, ref) => {
    const { config } = useChart();
    if (!active || !payload?.length) return null;
    return (
      <div
        ref={ref}
        className={cn(
          'border-border bg-popover px-sm py-xs text-2xs text-popover-foreground rounded-md border shadow-md',
          className,
        )}
        {...props}
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
                  className="size-2 shrink-0 rounded-sm"
                  // runtime-dynamic: chart entry color is data-driven
                  style={{
                    backgroundColor: itemConfig?.color ?? entry.color ?? 'var(--muted-foreground)',
                  }}
                />
                <span className="text-muted-foreground">{itemConfig?.label ?? entry.name}</span>
                <span className="text-foreground ml-auto font-mono tabular-nums">
                  {entry.value}
                </span>
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

interface ChartLegendContentProps extends React.ComponentProps<'div'> {
  payload?: Array<{
    value: string;
    color?: string;
    dataKey?: string;
  }>;
}

export const ChartLegendContent = React.forwardRef<HTMLDivElement, ChartLegendContentProps>(
  ({ payload, className, ...props }, ref) => {
    const { config } = useChart();
    if (!payload?.length) return null;
    return (
      <div
        ref={ref}
        className={cn('gap-md pt-md flex flex-wrap items-center justify-center', className)}
        {...props}
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
