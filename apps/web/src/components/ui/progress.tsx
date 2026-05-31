'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  type RadiusKey,
  radiusClass,
  type SizeKey,
  type ToneKey,
  toneFillClass,
} from '@/lib/variants';

/**
 * Progress bar for operations whose completion percentage is knowable — file
 * upload, sync ingest, batch import. Omit `value` (or pass `null`) for an
 * INDETERMINATE sweep when the duration is unknown (a modal upload before
 * chunked progress starts); under reduced-motion that falls back to a static
 * full-width fill so the busy state stays visible. For a small inline "spinning"
 * region use Spinner instead.
 *
 * `size` sets the bar height, `radius` defaults to `md` (shares the Input /
 * Select form-chrome family, not a pill) and `tone` colors the fill — pass
 * `success` at 100% or `warning` past a threshold. Pass an explicit `aria-label`
 * / `aria-labelledby` on the Root so AT announces what is progressing.
 *
 * @useWhen showing determinate 0-100 progress or an indeterminate unknown-duration sweep (use Spinner for a small inline busy region)
 */

const PROGRESS_HEIGHT: Record<SizeKey, string> = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };

export interface ProgressProps extends Omit<
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
  'value'
> {
  /** 0–100 percent. Omit (or pass `null`) for an indeterminate sweep. */
  value?: number | null;
  /** Bar height. Defaults to `md`. */
  size?: SizeKey;
  /** Track + fill corner radius. Defaults to `md` (form-chrome family). */
  radius?: RadiusKey;
  /** Fill color. Defaults to `primary`. */
  tone?: ToneKey;
}

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, size = 'md', radius = 'md', tone = 'primary', ...props }, ref) => {
  const indeterminate = value === undefined || value === null;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={indeterminate ? undefined : value}
      className={cn(
        'bg-muted relative w-full overflow-hidden',
        PROGRESS_HEIGHT[size],
        radiusClass[radius],
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full',
          toneFillClass[tone],
          indeterminate
            ? 'animate-progress-indeterminate w-2/5 motion-reduce:w-full motion-reduce:animate-none'
            : 'duration-base ease-out-quart w-full flex-1 transition-transform',
        )}
        // runtime-dynamic: determinate fill is driven by the value prop
        style={indeterminate ? undefined : { transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;
