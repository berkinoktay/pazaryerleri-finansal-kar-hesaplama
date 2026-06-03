import * as React from 'react';

import { cn } from '@/lib/utils';
import { type RadiusKey, radiusClass } from '@/lib/variants';

/**
 * Loading placeholder shaped like the content that will replace it. The point
 * is layout stability — set `width` / `height` (or Tailwind size utilities) to
 * match the target so there is no shift when real data arrives. Override the
 * shape with `className` (e.g. `rounded-full` for an avatar).
 *
 * `radius` defaults to `sm` (matches input + text-line corners, the most
 * common case). `animated` (default true) drives the pulse — pass `false` for
 * a static placeholder. The pulse is automatically disabled under
 * `prefers-reduced-motion`. Pass `label` on the OUTER skeleton of a region to
 * mark it `role="status" aria-busy` with a translated "loading" name.
 *
 * Skeleton screens beat spinners for first-load dashboards: with 6+ tiles
 * populating async, a single page-level spinner hides the structure;
 * per-tile skeletons preview it.
 *
 * @useWhen showing a per-region loading placeholder shaped like the content it will replace (prefer over a spinner for first-load views with multiple async tiles)
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Corner radius. Defaults to `sm`. Override per element (e.g. `radius="full"` for an avatar). */
  radius?: RadiusKey;
  /** Pulse animation. Defaults to true; pass `false` for a static placeholder. */
  animated?: boolean;
  /** When set, marks this element `role="status" aria-busy` with the translated label — use on a region's outer skeleton. */
  label?: string;
}

export function Skeleton({
  className,
  radius = 'sm',
  animated = true,
  label,
  ...props
}: SkeletonProps): React.ReactElement {
  return (
    <div
      role={label !== undefined ? 'status' : undefined}
      aria-busy={label !== undefined ? true : undefined}
      aria-label={label}
      className={cn('bg-muted', radiusClass[radius], animated && 'animate-pulse', className)}
      {...props}
    />
  );
}
