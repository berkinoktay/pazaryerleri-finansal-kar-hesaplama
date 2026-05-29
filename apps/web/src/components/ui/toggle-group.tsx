'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

/**
 * Group of mutually exclusive (`type="single"`) or independent
 * (`type="multiple"`) toggles. Two appearances:
 *
 * - `connected` (default) — a fused segment-bar: one bordered frame with
 *   vertical dividers, the ends rounded, and the selected item on a restrained
 *   --primary-soft (brand-tinted) surface. This is the product's segmented
 *   control for view-mode pickers, period selectors, and platform filters.
 *   (Deliberately NOT the muted-track "iOS segmented" look — that belongs to
 *   the Tabs primitive, so the two never read as duplicates.)
 * - `plain` — separate floating toggles (the standalone-Toggle look) with a
 *   gap; the selected item gets the same --primary-soft fill.
 *
 * Always give the group an accessible name (`aria-label` / `aria-labelledby`),
 * and give an icon-only item its own `aria-label`. `loop` (keyboard wrap,
 * default true) and `orientation` pass through to Radix.
 *
 * @useWhen rendering a small set of related toggles that should look unified and share a single-or-multiple selection rule
 */

type ToggleGroupAppearance = 'connected' | 'plain';

type ToggleGroupContextValue = VariantProps<typeof toggleVariants> & {
  appearance: ToggleGroupAppearance;
};

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
  variant: 'default',
  size: 'md',
  appearance: 'connected',
});

const groupRootClasses: Record<ToggleGroupAppearance, string> = {
  connected:
    'inline-flex w-fit items-center divide-x divide-border rounded-md border border-border data-[orientation=vertical]:flex-col data-[orientation=vertical]:divide-x-0 data-[orientation=vertical]:divide-y',
  plain: 'gap-3xs inline-flex items-center data-[orientation=vertical]:flex-col',
};

// Connected item overrides — twMerge resolves these over toggleVariants:
// drop the per-item border + radius (the frame owns them; the ends round via
// first/last). The selected fill (--primary-soft) is inherited from the shared
// toggle base. No overflow-clip on the frame so the focus glow is never cut off.
const CONNECTED_ITEM = 'rounded-none border-0 first:rounded-l-md last:rounded-r-md';

export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants> & { appearance?: ToggleGroupAppearance }
>(({ className, variant, size, appearance = 'connected', children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(groupRootClasses[appearance], className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size, appearance }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);
  const connected = context.appearance === 'connected';
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        // An explicit item-level prop overrides the group default; fall back
        // to the shared context otherwise. In `connected` the item look is
        // fixed (the frame owns it), so the item variant is pinned.
        toggleVariants({
          variant: connected ? 'default' : (variant ?? context.variant),
          size: size ?? context.size,
        }),
        connected && CONNECTED_ITEM,
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;
