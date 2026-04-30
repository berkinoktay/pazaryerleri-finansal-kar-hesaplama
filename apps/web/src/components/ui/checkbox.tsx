'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Boolean toggle whose state commits with the surrounding form. Use Switch
 * instead when the change should take effect immediately on toggle (e.g.
 * a settings page preference). Pair with a `<Label htmlFor>` so the
 * label provides the touch-target surface (16px box alone is too small
 * for finger input).
 *
 * @useWhen rendering a single boolean choice that commits on form submit (use Switch for immediate-effect toggles)
 */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer border-border-strong bg-background duration-fast size-4 shrink-0 rounded-xs border shadow-xs transition-colors',
      'hover:border-primary',
      'focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Tick02Icon className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
