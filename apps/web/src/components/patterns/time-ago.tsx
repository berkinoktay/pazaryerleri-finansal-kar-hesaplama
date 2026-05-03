'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';

/**
 * Relative-time label for past timestamps — "2 dk önce", "3 saat önce",
 * "Dün". Uses next-intl's `formatter.relativeTime` so the locale-aware
 * copy stays in sync with the surrounding UI.
 *
 * SSR-safe: the relative label depends on a client-only "now" reference.
 * Computing it during SSR would land a different timestamp than the
 * client renders during hydration, triggering a mismatch warning. The
 * component renders a deterministic absolute fallback ("21.04.2026
 * 14:32") on the server + first hydration paint, then swaps to the
 * relative label once mounted.
 *
 * The hover title attribute always shows the full absolute timestamp
 * (with explicit timezone when supplied) so users can verify exact
 * moments without losing the relative scan-friendliness of the body
 * label.
 *
 * @useWhen rendering a past timestamp as scannable relative text ("2 dk önce") with the absolute timestamp on hover (use Currency / DateRangePicker / Calendar for non-time scalar/range inputs)
 */

export interface TimeAgoProps {
  /**
   * Past time to render. ISO string or Date. `null` / `undefined`
   * renders the `placeholder` (defaults to em-dash).
   */
  value: string | Date | null | undefined;
  /**
   * Optional reference "now" for the relative comparison. Defaults to
   * `new Date()` resolved per render. Pass a fixed Date in tests so
   * snapshots stay deterministic.
   */
  now?: Date;
  /**
   * Optional explicit timezone label appended to the title (hover)
   * attribute, e.g. `"GMT+3"`. Skip when the surrounding surface
   * already conveys the timezone (SyncBadge already labels its own).
   */
  timezone?: string;
  /**
   * Display when `value` is null/undefined. Defaults to em-dash so the
   * column width stays consistent with populated rows.
   */
  placeholder?: string;
  /** Forwarded to the rendered `<time>` element. */
  className?: string;
}

export function TimeAgo({
  value,
  now,
  timezone,
  placeholder = '—',
  className,
}: TimeAgoProps): React.ReactElement {
  const formatter = useFormatter();
  const mounted = useIsMounted();

  if (value === null || value === undefined) {
    return <span className={className}>{placeholder}</span>;
  }

  const date = value instanceof Date ? value : new Date(value);

  // Absolute label is the canonical hover title AND the SSR-safe body
  // fallback before the client mount swap.
  const absolute = formatter.dateTime(date, 'short');
  const titleLabel = timezone !== undefined ? `${absolute} ${timezone}` : absolute;

  // Once mounted on the client, swap to the relative label. Comparing
  // against the supplied `now` (or `new Date()`) gives the locale-aware
  // "2 dk önce" / "Dün" copy that next-intl resolves.
  const body = mounted ? formatter.relativeTime(date, now ?? new Date()) : absolute;

  return (
    <time
      dateTime={date.toISOString()}
      title={titleLabel}
      className={cn('tabular-nums', className)}
    >
      {body}
    </time>
  );
}
