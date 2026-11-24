import {
  LIVE_ORDERS_CANCELLED_FILTER,
  LIVE_PERFORMANCE_PARAMS,
  LIVE_PERFORMANCE_PATH,
} from '@/lib/live-performance-links';

import type { OpenDayMatch } from '../api/list-orders.api';

/** What a today's search match is, from the orders page's point of view. */
export type OpenDayMatchKind = 'stored' | 'cancelled' | 'pending';

export function openDayMatchKind(match: OpenDayMatch): OpenDayMatchKind {
  if (match.source === 'buffer') return 'pending';
  return match.cancelled ? 'cancelled' : 'stored';
}

function liveHref(param: string, value: string): string {
  return `${LIVE_PERFORMANCE_PATH}?${new URLSearchParams({ [param]: value }).toString()}`;
}

const HREF_BY_KIND: Record<OpenDayMatchKind, (match: OpenDayMatch) => string> = {
  stored: (match) => liveHref(LIVE_PERFORMANCE_PARAMS.order, match.id),
  // The `?order=` resolver reads the feed of today's orders, which leaves
  // cancelled orders out by design, so a cancelled match opens the tab instead.
  cancelled: () => liveHref(LIVE_PERFORMANCE_PARAMS.ordersFilter, LIVE_ORDERS_CANCELLED_FILTER),
  // A buffer entry is still waiting to become an order: its own sheet opens and
  // follows it once it is promoted.
  pending: (match) => liveHref(LIVE_PERFORMANCE_PARAMS.buffer, match.id),
};

/** Where a today's search match lives on live performance. */
export function openDayMatchHref(match: OpenDayMatch): string {
  return HREF_BY_KIND[openDayMatchKind(match)](match);
}
