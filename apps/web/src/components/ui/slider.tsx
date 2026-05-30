'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { type RadiusKey, radiusClass, type SizeKey } from '@/lib/variants';

/**
 * Numeric input over a continuous scale where relative position matters more
 * than the exact value. Renders one thumb per entry in `value` /
 * `defaultValue`, so a two-element array yields a range picker. For
 * exact-value entry use Input `type="number"` — sliders are imprecise by
 * design and pair best with a labelled live-value readout. Pair with a
 * `<Label>` (wire `aria-labelledby`) or pass `aria-label` for screen readers.
 *
 * The thumb is a flat --primary fill (consistent with Button's solid surface,
 * not an outlined hollow). Focus uses the global :focus-visible brand glow —
 * the compact thumb absorbs the proportional ring cleanly; on touch the thumb
 * expands to a 44px hit area (`pointer-coarse:size-11`).
 *
 * @useWhen rendering a single or range numeric input over a continuous scale where relative position matters more than exact value
 */

const SLIDER_TRACK_HEIGHT: Record<SizeKey, string> = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
const SLIDER_THUMB_SIZE: Record<SizeKey, string> = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' };

export interface SliderProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
  'size'
> {
  /** Thumb + track dimension. Defaults to `md`. */
  size?: SizeKey;
  /** Corner radius of the track and thumb. Defaults to `full` (the canonical pill). */
  radius?: RadiusKey;
}

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, size = 'md', radius = 'full', ...props }, ref) => (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none items-center select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'bg-muted relative w-full grow overflow-hidden',
          SLIDER_TRACK_HEIGHT[size],
          radiusClass[radius],
        )}
      >
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      {(props.defaultValue ?? props.value ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className={cn(
            // border-background = a thin page-bg halo so the filled thumb reads
            // as a distinct handle floating over the range (Stripe/Linear style).
            'bg-primary border-background block shrink-0 border-2 shadow-sm',
            'duration-fast ease-out-quart transition-colors',
            'hover:bg-primary-hover',
            'pointer-coarse:size-11',
            SLIDER_THUMB_SIZE[size],
            radiusClass[radius],
          )}
        />
      ))}
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = SliderPrimitive.Root.displayName;
