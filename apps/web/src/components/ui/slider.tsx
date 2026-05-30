'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
 * keyboard focus — this reuses the shared Tooltip primitive with a CONTROLLED
 * `open` (driven by hover+focus state) so it bypasses Radix Tooltip's
 * pointer-down-closes behaviour and stays visible through a drag. `formatValue`
 * formats both that bubble and the thumb's `aria-valuetext` (e.g. `(v) =>
 * \`₺\${v}\``, `(v) => \`%\${v}\``).
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
  /** Float each thumb's current value above it on hover / drag / focus, via the shared Tooltip. */
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

    // Hover and keyboard/drag focus are tracked separately so the value stays
    // visible during a drag even when the pointer slips off the moving thumb
    // (focus survives) — open = hovered OR focused.
    const [hoveredThumb, setHoveredThumb] = React.useState<number | null>(null);
    const [focusedThumb, setFocusedThumb] = React.useState<number | null>(null);

    const renderThumb = (thumbValue: number, i: number): React.ReactElement => {
      const thumb = (
        <SliderPrimitive.Thumb
          key={i}
          aria-valuetext={formatValue ? formatValue(thumbValue) : undefined}
          onPointerEnter={() => setHoveredThumb(i)}
          onPointerLeave={() => setHoveredThumb((prev) => (prev === i ? null : prev))}
          onFocus={() => setFocusedThumb(i)}
          onBlur={() => setFocusedThumb((prev) => (prev === i ? null : prev))}
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
      );

      if (!tooltip) return thumb;

      // Controlled open bypasses Radix Tooltip's pointer-down-closes behaviour,
      // so the value survives a pointer drag (the trigger's own open logic is
      // ignored while `open` is provided without `onOpenChange`).
      return (
        <Tooltip key={i} open={hoveredThumb === i || focusedThumb === i}>
          <TooltipTrigger asChild>{thumb}</TooltipTrigger>
          <TooltipContent sideOffset={8} className="tabular-nums">
            {formatValue ? formatValue(thumbValue) : thumbValue}
          </TooltipContent>
        </Tooltip>
      );
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
        {currentValue.map(renderThumb)}
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;
