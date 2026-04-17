'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Two visual variants cover the common dashboard needs:
 *
 *   - `pill` (default): segmented control inside a muted container. Used
 *     when the tabs live inside a constrained card or toolbar. Active
 *     tab becomes a surfaced card-colored pill.
 *
 *   - `underline`: airier, content-integrated. Used when tabs introduce
 *     a full page section. No container — just a bottom divider with
 *     an active-state underline.
 *
 * Size scale is shared via the primitive size convention: sm / md / lg.
 */

// Size scale aligned with Button/Input (h-8/h-10/h-11) — one size key, one token across primitives.
const tabsListVariants = cva('inline-flex items-center text-muted-foreground', {
  variants: {
    variant: {
      pill: 'gap-3xs rounded-lg border border-border bg-muted p-3xs',
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
    'inline-flex items-center justify-center whitespace-nowrap font-medium',
    'transition-colors duration-fast',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    'cursor-pointer',
  ),
  {
    variants: {
      variant: {
        // Pill: fills the muted container's inner height (minus p-3xs padding) via h-full.
        // Active reads as a surfaced card (bg-card + shadow-sm + subtle ring for definition).
        // Inactive hover surfaces a faint background so non-primary tabs still signal "clickable".
        pill: cn(
          'h-full rounded-md',
          'hover:text-foreground',
          'data-[state=inactive]:hover:bg-background/50',
          'data-[state=active]:bg-card',
          'data-[state=active]:text-foreground',
          'data-[state=active]:shadow-sm',
          'data-[state=active]:ring-1 data-[state=active]:ring-border-muted',
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

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const { variant, size } = React.useContext(TabsContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerVariants({ variant, size }), className)}
      {...props}
    />
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
