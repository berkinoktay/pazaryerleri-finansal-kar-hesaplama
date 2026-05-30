'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Switch between sibling content panels at the same hierarchy level
 * (e.g. Overview / Orders / Settings inside a single store page). Use
 * Tabs only when the panels carry equivalent weight; if one panel is
 * the default and the others are auxiliary, prefer Sidebar navigation
 * or progressive disclosure.
 *
 * Two visual variants cover the common dashboard needs:
 *
 *   - `pill` (default): segmented control inside a muted rounded-full track.
 *     Used when the tabs live inside a constrained card or toolbar. The
 *     active tab is a clean white chip (subtle shadow-sm lift) with a
 *     brand-colored `text-primary` label — the color is in the label, not a
 *     fill. `TabsTrigger count={n}` adds a solid-primary metric badge.
 *
 *   - `underline`: airier, content-integrated. Used when tabs introduce
 *     a full page section. No container — just a bottom divider with
 *     an active-state underline.
 *
 * Size scale is shared via the primitive size convention: sm / md / lg.
 *
 * @useWhen switching between sibling content panels at the same hierarchy level (use Sidebar navigation when one panel is primary and others are auxiliary)
 */

// Size scale aligned with Button/Input (h-8/h-10/h-11) — one size key, one token across primitives.
const tabsListVariants = cva('inline-flex items-center text-muted-foreground', {
  variants: {
    variant: {
      pill: 'gap-3xs rounded-full bg-muted p-3xs',
      underline: 'gap-lg w-full justify-start border-b border-border',
    },
    size: {
      sm: 'h-8',
      md: 'h-10',
      lg: 'h-11',
    },
  },
  defaultVariants: { variant: 'pill', size: 'md' },
});

const tabsTriggerVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2xs whitespace-nowrap font-medium',
    'transition-colors duration-fast',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    'cursor-pointer',
  ),
  {
    variants: {
      variant: {
        // Pill: fills the muted pill track's inner height (minus p-3xs) via h-full.
        // Active reads as a clean WHITE chip that lifts off the track with a
        // subtle shadow-sm (not the old heavy shadow-md / ring), and the BRAND
        // color lives in the active LABEL (`text-primary`), never a fill — the
        // refined segmented look (white chip + primary text, Linear / Vercel
        // tier). Inactive hover surfaces a faint background so non-active tabs
        // still signal "clickable". Active weight stays `font-medium` (no
        // semibold swap) to avoid width jitter when switching tabs.
        pill: cn(
          'h-full rounded-full',
          'hover:text-foreground',
          'data-[state=inactive]:hover:bg-surface-trigger-hover',
          'data-[state=active]:bg-card',
          'data-[state=active]:text-primary',
          'data-[state=active]:shadow-sm',
        ),
        // Underline: container has border-b; trigger overlaps it with its own border-b-2 via -mb-px.
        // Weight stays constant (no semibold swap) to prevent width jitter when switching tabs.
        // Inactive hover previews the underline with border-strong to advertise interactivity.
        underline: cn(
          'relative -mb-px h-full rounded-none',
          'border-b-2 border-transparent',
          'hover:text-foreground',
          'data-[state=inactive]:hover:border-border-strong',
          'data-[state=active]:border-primary',
          'data-[state=active]:text-foreground',
        ),
      },
      size: {
        sm: 'px-sm text-xs',
        md: 'px-md text-sm',
        lg: 'px-lg text-base',
      },
    },
    defaultVariants: { variant: 'pill', size: 'md' },
  },
);

type TabsVariantProps = VariantProps<typeof tabsListVariants>;

interface TabsContextValue {
  variant: NonNullable<TabsVariantProps['variant']>;
  size: NonNullable<TabsVariantProps['size']>;
}

const TabsContext = React.createContext<TabsContextValue>({ variant: 'pill', size: 'md' });

export interface TabsProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>, TabsVariantProps {}

export const Tabs = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ variant = 'pill', size = 'md', children, ...props }, ref) => (
    <TabsContext.Provider value={{ variant: variant ?? 'pill', size: size ?? 'md' }}>
      <TabsPrimitive.Root ref={ref} {...props}>
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  ),
);
Tabs.displayName = TabsPrimitive.Root.displayName;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const { variant, size } = React.useContext(TabsContext);
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(tabsListVariants({ variant, size }), className)}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> {
  /**
   * Optional count badge after the label (pending orders, unread, …). Renders
   * a solid-primary numeric pill that reads the same on active and inactive
   * triggers — the metric lives in the tab, the active state is carried by the
   * chip + `text-primary` label. Pass a number or a node like `99+`.
   */
  count?: React.ReactNode;
}

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, count, children, ...props }, ref) => {
  const { variant, size } = React.useContext(TabsContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerVariants({ variant, size }), className)}
      {...props}
    >
      {children}
      {count !== undefined ? (
        // Keyed by the value so a changing count remounts and replays the
        // pop (mount + every update). The pop reuses the same restrained
        // `animate-in zoom-in-75` enter as the NotificationBell count badge —
        // no bounce, reduced-motion-collapsed globally. Stays solid-primary.
        <span
          key={String(count)}
          className="animate-in fade-in zoom-in-75 duration-fast bg-primary text-primary-foreground px-3xs text-2xs inline-flex h-5 min-w-5 items-center justify-center rounded-full font-semibold tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-md focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
