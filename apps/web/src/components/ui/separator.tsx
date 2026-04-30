'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Visual divider between sibling content groups. Defaults to
 * `decorative`, meaning screen readers skip it — set `decorative=false`
 * when the divider carries semantic meaning (e.g. between two
 * sections of a menu where order matters). Reach for spacing first;
 * a Separator only earns its place when the surrounding content
 * groups would visually run together without it.
 *
 * @useWhen drawing a thin horizontal or vertical line between sibling content groups that need a visible boundary beyond plain spacing
 */
export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'bg-border shrink-0',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;
