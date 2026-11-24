/**
 * Live performance's URL contract: its path and the query params its page reads.
 * Shared because other features link into it (the orders page sends today's orders
 * there); the live-performance feature reads its params through these same names,
 * so a rename cannot silently break a link from elsewhere.
 */
export const LIVE_PERFORMANCE_PATH = '/live-performance';

export const LIVE_PERFORMANCE_PARAMS = {
  /** A stored order of today: opens its detail sheet. */
  order: 'order',
  /** A buffer entry of today: opens its detail sheet and follows it once promoted. */
  buffer: 'buffer',
  /** The orders table's tab. */
  ordersFilter: 'ordersFilter',
} as const;

/** The orders table tab listing today's cancelled orders. */
export const LIVE_ORDERS_CANCELLED_FILTER = 'cancelled';
