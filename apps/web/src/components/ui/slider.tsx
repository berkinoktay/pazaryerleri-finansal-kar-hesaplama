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
 * The thumb is a flat --primary fill with a thin page-bg halo (consistent with
 * Button's solid surface, not an outlined hollow). Focus uses the global
 * :focus-visible brand glow; on touch the thumb expands to a 44px hit area.
 *
 * Set `tooltip` to float each thumb's current value above it on hover / drag /
 * keyboard focus; `formatValue` formats both that bubble and the thumb's
 * `aria-valuetext` (e.g. `(v) => \`₺\${v}\``, `(v) => \`%\${v}\``).
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
  /** Float each thumb's current value above it on hover / drag / focus. */
  tooltip?: boolean;
  /** Format the value bubble + `aria-valuetext` — e.g. currency or percent. Defaults to the raw number. */
  formatValue?: (value: number) => string;
}

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      className,
      size = 'md',
      radius = 'full',
      tooltip = false,
      formatValue,
      value,
      defaultValue,
      onValueChange,
      ...props
    },
    ref,
  ) => {
    // Track the live value (controlled or uncontrolled) so the tooltip bubble +
    // aria-valuetext can render the current per-thumb value.
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState<number[]>(
      value ?? defaultValue ?? [0],
    );
    const currentValue = isControlled ? value : internalValue;

    const handleValueChange = (next: number[]): void => {
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
    };

    return (
      <SliderPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
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
        {currentValue.map((thumbValue, i) => (
          <SliderPrimitive.Thumb
            key={i}
            aria-valuetext={formatValue ? formatValue(thumbValue) : undefined}
            className={cn(
              // border-background = a thin page-bg halo so the filled thumb reads
              // as a distinct handle floating over the range (Stripe/Linear style).
              'group/thumb bg-primary border-background block shrink-0 border-2 shadow-sm',
              'duration-fast ease-out-quart transition-colors',
              'hover:bg-primary-hover',
              'pointer-coarse:size-11',
              SLIDER_THUMB_SIZE[size],
              radiusClass[radius],
            )}
          >
            {tooltip ? (
              <span
                className={cn(
                  'mb-xs pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2',
                  'bg-card border-border text-foreground px-xs py-3xs text-2xs rounded-md border shadow-md',
                  'whitespace-nowrap tabular-nums',
                  'duration-fast ease-out-quart opacity-0 transition-opacity',
                  'group-hover/thumb:opacity-100 group-focus/thumb:opacity-100',
                )}
              >
                {formatValue ? formatValue(thumbValue) : thumbValue}
              </span>
            ) : null}
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;
