'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none items-center select-none', className)}
    {...props}
  >
    <SliderPrimitive.Track className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full">
      <SliderPrimitive.Range className="bg-primary absolute h-full" />
    </SliderPrimitive.Track>
    {(props.defaultValue ?? props.value ?? [0]).map((_, i) => (
      <SliderPrimitive.Thumb
        key={i}
        className={cn(
          'border-primary bg-background duration-fast block size-4 rounded-full border shadow-sm transition-colors',
          'focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      />
    ))}
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;
