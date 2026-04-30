'use client';

import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Immediately-actioned on/off toggle (e.g. a settings preference that
 * persists the moment the user flips it). Use Checkbox instead when the
 * change is part of a form that commits on submit. The thumb transition
 * uses `duration-base` + `ease-out-quart` — no bounce, matches the
 * disciplined motion language documented in the design system.
 *
 * @useWhen rendering an immediately-actioned on/off toggle (use Checkbox if the change should commit on form submit)
 */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      'peer duration-fast inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
      'focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted',
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'bg-background duration-base ease-out-quart pointer-events-none block size-4 rounded-full shadow-sm ring-0 transition-transform',
        'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;
