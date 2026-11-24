import type { OpenDayMatch } from '../api/list-orders.api';

export const LIVE_PERFORMANCE_PATH = '/live-performance';

// Live performance's URL contract: `?order=<id>` opens a stored order's detail
// sheet from today's feed; `?ordersFilter=cancelled` opens its orders table on
// the cancelled tab. Mirrored here because the orders feature may not import
// from the live-performance feature.
const LIVE_ORDER_PARAM = 'order';
const LIVE_ORDERS_FILTER_PARAM = 'ordersFilter';
const LIVE_CANCELLED_FILTER = 'cancelled';

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
  stored: (match) => liveHref(LIVE_ORDER_PARAM, match.id),
  // The `?order=` resolver reads the feed of today's orders, which leaves
  // cancelled orders out by design, so a cancelled match opens the tab instead.
  cancelled: () => liveHref(LIVE_ORDERS_FILTER_PARAM, LIVE_CANCELLED_FILTER),
  // A buffer entry is still waiting to become an order: live performance lists it.
  pending: () => LIVE_PERFORMANCE_PATH,
};

/** Where a today's search match lives on live performance. */
export function openDayMatchHref(match: OpenDayMatch): string {
  return HREF_BY_KIND[openDayMatchKind(match)](match);
}
