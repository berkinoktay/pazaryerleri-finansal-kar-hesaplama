'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cva, type VariantProps } from 'class-variance-authority';
import { MinusSignIcon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Boolean (or tri-state) toggle whose state commits with the surrounding
 * form. Use Switch instead when the change should take effect immediately on
 * toggle. Pair with a `<Label htmlFor>` — the label carries the full 44px
 * touch target; the box itself is a `pointer-coarse:size-5` safety net, not
 * the primary hit area.
 *
 * Tri-state: pass `checked="indeterminate"` (e.g. a table select-all header
 * with a partial selection) — the indicator swaps the check for a minus on a
 * full --primary fill, so the three states stay visually distinct.
 *
 * Binary control → the checked/indeterminate state is full --primary
 * (decisive), NOT the --primary-soft used by soft press-toggles
 * (Toggle/ToggleGroup). Focus uses the global :focus-visible brand glow (a
 * compact box absorbs the proportional ring cleanly) — no per-component
 * focus override.
 *
 * @useWhen rendering a single boolean or tri-state choice that commits on form submit (use Switch for immediate-effect toggles)
 */

const checkboxVariants = cva(
  [
    // bg-input (pure white), not bg-background: form-control fill contract —
    // on the tinted canvas a bg-background fill would read as a dirty-gray box.
    'peer border-border-strong bg-input shrink-0 border shadow-xs',
    'transition duration-fast ease-out-quart',
    'hover:border-primary',
    'active:scale-[0.97]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
    'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
    'aria-invalid:border-destructive',
    'data-[valid=true]:border-success',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'size-3.5 pointer-coarse:size-5',
        md: 'size-4 pointer-coarse:size-5',
        lg: 'size-5 pointer-coarse:size-6',
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
    defaultVariants: { size: 'md', radius: 'xs' },
  },
);

export interface CheckboxProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'size'>,
    VariantProps<typeof checkboxVariants> {
  /** Convenience boolean for `aria-invalid="true"` — destructive border for form errors. */
  invalid?: boolean;
  /** Marks the field as validated-OK — success-tinted border. Mutually exclusive with `invalid`. */
  valid?: boolean;
}

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, size, radius, invalid, valid, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    aria-invalid={invalid ?? undefined}
    data-valid={valid === true ? 'true' : undefined}
    className={cn(checkboxVariants({ size, radius }), className)}
    {...props}
  >
    {/* forceMount so the indicator can FADE on check/uncheck (Radix would
        otherwise mount/unmount it instantly). The icon swaps tick -> minus on
        the indeterminate tri-state via the named group's data-state. */}
    <CheckboxPrimitive.Indicator
      forceMount
      className={cn(
        'group/indicator flex items-center justify-center text-current',
        'duration-fast ease-out-quart opacity-0 transition-opacity',
        'data-[state=checked]:opacity-100 data-[state=indeterminate]:opacity-100',
      )}
    >
      <Tick02Icon
        strokeWidth={3}
        className="size-3 group-data-[state=indeterminate]/indicator:hidden"
      />
      <MinusSignIcon
        strokeWidth={3}
        className="hidden size-3 group-data-[state=indeterminate]/indicator:block"
      />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { checkboxVariants };
