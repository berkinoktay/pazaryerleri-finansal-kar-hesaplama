'use client';

import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Single two-state press-and-hold control (e.g. Bold in a text editor,
 * pinned/unpinned on a row). Use Switch for an immediately-actioned
 * settings toggle, Checkbox for a form-submit boolean. For 2+ mutually
 * exclusive press states, compose into a `ToggleGroup` so Radix
 * coordinates the single-active invariant.
 *
 * Shares the `size` (sm | md | lg + icon | icon-sm) and `radius` axes with
 * Button so they line up in a toolbar. Icon-only toggles (`size="icon*"`)
 * MUST be given an `aria-label`. Accepts Radix `asChild` via props.
 *
 * @useWhen rendering a single press-and-hold two-state control (use Switch for settings, ToggleGroup for mutually exclusive picks)
 */

const toggleVariants = cva(
  // off-hover lifts to surface-trigger-hover (a neutral lift) — kept lighter
  // than the on-state's --primary-soft brand-tinted fill so the selected chip
  // is unambiguously the strongest, branded surface, never confused with hover.
  'inline-flex cursor-pointer items-center justify-center gap-xs font-medium transition duration-fast ease-out-quart active:scale-[0.97] pointer-coarse:min-h-11 [&_svg]:size-icon-sm [&_svg]:shrink-0 hover:bg-surface-trigger-hover hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary-soft data-[state=on]:text-primary-soft-foreground data-[state=on]:hover:bg-primary-soft',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-border bg-transparent',
      },
      // Heights + paddings + text sizes align 1:1 with Button and the form
      // fields so a toolbar mixing them stays on one baseline. `icon` /
      // `icon-sm` are square for icon-only toggles (give them an aria-label).
      size: {
        sm: 'h-8 px-sm text-xs',
        md: 'h-10 px-md text-sm',
        lg: 'h-11 px-lg text-base',
        icon: 'size-10 min-w-10 pointer-coarse:size-11',
        'icon-sm': 'size-8 min-w-8 pointer-coarse:size-11',
      },
      radius: {
        none: 'rounded-none',
        xs: 'rounded-xs',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
        '2xl': 'rounded-2xl',
        full: 'rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'md', radius: 'md' },
  },
);

export const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, radius, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, radius, className }))}
    {...props}
  />
));
Toggle.displayName = TogglePrimitive.Root.displayName;

export { toggleVariants };
