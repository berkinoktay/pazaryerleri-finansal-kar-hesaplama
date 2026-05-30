'use client';

import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Immediately-actioned on/off toggle (a settings preference that persists the
 * moment the user flips it). Use Checkbox instead when the change is part of a
 * form that commits on submit. Pair with a `<Label htmlFor>` (the label
 * carries the touch target); for a standalone switch pass `aria-label`.
 *
 * Binary control → the 'on' track is full --primary (decisive), NOT the
 * --primary-soft used by soft press-toggles (Toggle/ToggleGroup). Focus
 * replaces the heavy 3px global brand glow (too boxy on a 20px control) with a
 * tight offset ring; the thumb slides at duration-fast ease-out-quart — no
 * bounce, matching the disciplined motion language.
 *
 * @useWhen rendering an immediately-actioned on/off toggle (use Checkbox if the change should commit on form submit)
 */

const switchVariants = cva(
  [
    'peer inline-flex shrink-0 cursor-pointer items-center border border-transparent',
    'transition duration-fast ease-out-quart',
    'active:scale-[0.95]',
    // A 3px glow on a 20px control reads boxy — swap it for a tight offset ring
    // (still a visible focus affordance when unchecked, where there is no fill).
    'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=unchecked]:bg-muted data-[state=unchecked]:hover:bg-surface-trigger-hover',
    'data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary-hover',
    'aria-invalid:border-destructive',
    'data-[valid=true]:border-success',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-4 w-7',
        md: 'h-5 w-9',
        lg: 'h-6 w-11',
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
    defaultVariants: { size: 'md', radius: 'full' },
  },
);

// Thumb dimension + checked travel scale with the track (travel = w − thumb − 4px).
const switchThumbVariants = cva(
  [
    'bg-background pointer-events-none block rounded-full shadow-sm ring-0',
    'transition-transform duration-fast ease-out-quart',
    'data-[state=unchecked]:translate-x-0.5',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'size-3 data-[state=checked]:translate-x-3',
        md: 'size-4 data-[state=checked]:translate-x-4',
        lg: 'size-5 data-[state=checked]:translate-x-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface SwitchProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>, 'size'>,
    VariantProps<typeof switchVariants> {
  /** Convenience boolean for `aria-invalid="true"` — destructive track border for form errors. */
  invalid?: boolean;
  /** Marks the field as validated-OK — success track border. Mutually exclusive with `invalid`. */
  valid?: boolean;
}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, size, radius, invalid, valid, ...props }, ref) => (
    <SwitchPrimitives.Root
      ref={ref}
      aria-invalid={invalid ?? undefined}
      data-valid={valid === true ? 'true' : undefined}
      className={cn(switchVariants({ size, radius }), className)}
      {...props}
    >
      <SwitchPrimitives.Thumb className={cn(switchThumbVariants({ size }))} />
    </SwitchPrimitives.Root>
  ),
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { switchVariants };
