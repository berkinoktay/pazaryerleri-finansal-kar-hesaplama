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
 * @useWhen rendering a single press-and-hold two-state control (use Switch for settings, ToggleGroup for mutually exclusive picks)
 */

const toggleVariants = cva(
  'inline-flex items-center justify-center gap-xs rounded-md text-sm font-medium transition-colors duration-fast [&_svg]:size-icon-sm [&_svg]:shrink-0 hover:bg-muted hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-border bg-transparent',
      },
      size: {
        sm: 'h-8 px-xs',
        md: 'h-9 px-sm',
        lg: 'h-10 px-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
));
Toggle.displayName = TogglePrimitive.Root.displayName;

export { toggleVariants };
