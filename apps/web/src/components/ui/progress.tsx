'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Determinate progress bar (0–100) for operations whose completion
 * percentage is knowable — file upload, sync ingest, batch import.
 * For indeterminate "something is happening" feedback use Spinner
 * instead. Pass an explicit aria-label or aria-labelledby on the Root
 * so assistive tech announces what is progressing, not just "X%".
 *
 * @useWhen showing determinate 0-100 progress (use Spinner when the percentage is unknown)
 */
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('bg-muted relative h-1.5 w-full overflow-hidden rounded-full', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="bg-primary duration-slow ease-out-quart h-full w-full flex-1 transition-transform"
      // runtime-dynamic: progress value is a prop-driven percentage, cannot be tokenized
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;
