import * as React from 'react';

import { cn } from '@/lib/utils';
import { type ToneKey, toneSolidClass } from '@/lib/variants';

/**
 * Compact solid numeric count pill — a small rounded-full badge holding a
 * number (unread notifications, pending orders, a tab's item count).
 * `tabular-nums` keeps digits from jittering; a single digit reads as a
 * circle and multi-digit grows into a pill. Pass `animate` together with a
 * `key={String(value)}` to replay a de-bounced zoom-pop whenever the value
 * changes — the shared NotificationBell / Tabs idiom. For a labelled status
 * chip use Badge; this is numbers only.
 *
 * @useWhen showing a small solid numeric count pill (unread / pending / tab counts) — use Badge for labelled status chips
 */
export interface CountBadgeProps extends React.ComponentPropsWithoutRef<'span'> {
  /** Solid fill tone from the shared tone system. Default `primary`. */
  tone?: ToneKey;
  /** Replay the zoom-pop on remount — pair with `key={String(value)}` so a changing count re-animates. */
  animate?: boolean;
}

export const CountBadge = React.forwardRef<HTMLSpanElement, CountBadgeProps>(
  ({ tone = 'primary', animate = false, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'px-3xs text-2xs inline-flex h-5 min-w-5 items-center justify-center rounded-full font-semibold tabular-nums',
        toneSolidClass[tone],
        animate && 'animate-in fade-in zoom-in-75 duration-fast',
        className,
      )}
      {...props}
    />
  ),
);
CountBadge.displayName = 'CountBadge';
