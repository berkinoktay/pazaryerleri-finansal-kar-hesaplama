'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Visual divider between sibling content groups. Defaults to `decorative`,
 * meaning screen readers skip it — set `decorative=false` when the divider
 * carries semantic meaning (e.g. between two menu sections where order
 * matters). Reach for spacing first; a Separator only earns its place when
 * the surrounding content groups would visually run together without it.
 *
 * `variant` tunes the line weight to the context (all from the border token
 * family — no new color):
 *   - `muted` (`border-muted`): the softest hairline — inner dividers inside a
 *     card or between list rows, where a full border reads too heavy.
 *   - `default` (`border`): the standard divider.
 *   - `strong` (`border-strong`): a firmer line between major page sections.
 *
 * @useWhen drawing a thin horizontal or vertical line between sibling content groups that need a visible boundary beyond plain spacing (pick `variant` to match how hard the separation should read)
 */

const separatorVariants = cva('shrink-0', {
  variants: {
    variant: {
      muted: 'bg-border-muted',
      default: 'bg-border',
      strong: 'bg-border-strong',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface SeparatorProps
  extends
    React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>,
    VariantProps<typeof separatorVariants> {}

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  SeparatorProps
>(({ className, orientation = 'horizontal', decorative = true, variant, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      separatorVariants({ variant }),
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;
