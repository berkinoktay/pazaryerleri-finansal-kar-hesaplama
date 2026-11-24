'use client';

import * as React from 'react';

import { subscribeCompletedDayOrders } from '@/lib/recent-orders-bus';

/**
 * Quiet period of the trailing debounce for list refetches driven by Realtime
 * order inserts: the refetch runs once no id has arrived for this long. Longer
 * than the sync worker's buffer-promote tick (5 s, one chunk of rows per tick),
 * so a midnight graduation that inserts a day of orders tick after tick folds
 * into one refetch instead of one per tick. Separate from the notifier's OWN
 * toast coalesce: this is list-only.
 */
export const ORDERS_REALTIME_REFRESH_DEBOUNCE_MS = 7_000;

/**
 * The longest a stream of ids can hold the refetch back: a stream that never
 * goes quiet (a long backfill) still refreshes the list at most once per this
 * period, so the page does not stay stale until the stream ends.
 */
export const ORDERS_REALTIME_REFRESH_MAX_WAIT_MS = 30_000;

/**
 * Refetch the orders list + KPI summary when orders of a completed business day
 * arrive over Realtime (a midnight buffer graduation, a late arrival). The
 * live-performance notifier publishes each such id onto the recent-orders bus;
 * today's inserts are never published, because the list hides them until the
 * day ends. Subscribing to an external pub/sub is exactly what `useEffect` is for.
 *
 * `onRefresh` is the SAME invalidation the page runs on `onFlowsSettled`
 * (useRefreshOrders) — passed in and reused, never duplicated. A trailing
 * debounce with a maximum wait: each id restarts the quiet period, the first id
 * of a burst arms the max-wait timer, and whichever fires first refetches and
 * clears both. A ref keeps the subscription stable across the callback's
 * changing identity, so the channel is never torn down and rebuilt on an
 * unrelated re-render.
 */
export function useOrdersRealtimeRefresh(onRefresh: () => void): void {
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  React.useEffect(() => {
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      if (maxWaitTimer !== null) clearTimeout(maxWaitTimer);
      quietTimer = null;
      maxWaitTimer = null;
    };

    const fire = (): void => {
      clearTimers();
      onRefreshRef.current();
    };

    const unsubscribe = subscribeCompletedDayOrders(() => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(fire, ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
      maxWaitTimer ??= setTimeout(fire, ORDERS_REALTIME_REFRESH_MAX_WAIT_MS);
    });

    return () => {
      unsubscribe();
      clearTimers();
    };
  }, []);
}
