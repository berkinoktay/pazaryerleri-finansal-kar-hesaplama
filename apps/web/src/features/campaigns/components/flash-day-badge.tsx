'use client';

import { Calendar01Icon } from 'hugeicons-react';
import { useFormatter } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

export interface FlashDayBadgeProps {
  /** The row's primary flash-window start — a fixed ISO date-time (deterministic, SSR-safe). */
  startsAt: string;
}

/**
 * The row's flash DAY as a neutral soft chip — "8 Temmuz" — the muadili of the dated chip
 * Trendyol stamps on every flash row. The SAME product recurs across several dated rows, so
 * this chip tells the seller WHICH day a given row belongs to, right inside the product
 * identity cell. Rendered from a fixed ISO prop via the named `dayMonth` preset, so it is
 * deterministic and hydration-safe (no `Date.now()`). Pairs with the offer card's time-range
 * badge in the same neutral family.
 */
export function FlashDayBadge({ startsAt }: FlashDayBadgeProps): React.ReactElement {
  const format = useFormatter();
  return (
    <Badge
      tone="neutral"
      variant="surface"
      size="sm"
      leadingIcon={<Calendar01Icon />}
      className="tabular-nums"
    >
      {format.dateTime(new Date(startsAt), 'dayMonth')}
    </Badge>
  );
}
