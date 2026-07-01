'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Single-choice picker among 2–7 mutually exclusive, fully-visible options.
 * Beyond 7 options use Select (or Combobox once it lands) instead — a long
 * radio list buries the choice in scroll. Each `RadioGroupItem` should be
 * paired with a `<Label htmlFor>` for hit-area + screen-reader association
 * (the control is a `pointer-coarse:size-5` safety net; the label carries the
 * 44px touch target).
 *
 * Binary control → the checked dot is full --primary (decisive), NOT the
 * --primary-soft used by soft press-toggles (Toggle/ToggleGroup). The circle
 * IS the radio's identity, so there is intentionally NO `radius` axis (a
 * square radio is a semantic anti-pattern) — only a `size` axis. Focus uses
 * the global :focus-visible brand glow; the compact circle absorbs the
 * proportional ring cleanly (no per-component override).
 *
 * `orientation` ('vertical' default | 'horizontal') and `loop` (keyboard wrap,
 * default true) pass through to Radix.
 *
 * @useWhen rendering 2-7 mutually exclusive options that benefit from being all visible at once (use Select for longer lists)
 */
export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('gap-xs grid', className)} {...props} />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const radioGroupItemVariants = cva(
  [
    // `peer` so a disabled item dims its sibling <Label> (peer-disabled:),
    // making the whole row read as disabled — not just the faint circle.
    // bg-input (pure white), not bg-background: form-control fill contract —
    // matches Checkbox so unchecked controls stay bright on the tinted canvas.
    'peer border-border-strong bg-input shrink-0 rounded-full border shadow-xs',
    'transition duration-fast ease-out-quart',
    'hover:border-primary',
    'active:scale-[0.95]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:border-primary',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'size-3.5 pointer-coarse:size-5',
        md: 'size-4 pointer-coarse:size-5',
        lg: 'size-5 pointer-coarse:size-6',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

// Inner dot scales with the ring so the checked mark stays proportional.
const RADIO_DOT_SIZE = { sm: 'size-1.5', md: 'size-2', lg: 'size-2.5' } as const;

export interface RadioGroupItemProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, 'size'>,
    VariantProps<typeof radioGroupItemVariants> {}

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, size, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(radioGroupItemVariants({ size }), className)}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      {/* Dot pops in on select (scale entrance, no bounce); reduced-motion handled globally. */}
      <span
        className={cn(
          'bg-primary animate-in zoom-in-75 duration-fast ease-out-quart rounded-full',
          RADIO_DOT_SIZE[size ?? 'md'],
        )}
      />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { radioGroupItemVariants };
