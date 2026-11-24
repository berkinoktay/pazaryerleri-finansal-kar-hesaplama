'use client';

import * as React from 'react';

import { subscribeCompletedDayOrders } from '@/lib/recent-orders-bus';

/**
 * Coalesce window for list refetches driven by Realtime order inserts. The
 * midnight buffer graduation inserts a whole day of orders back-to-back;
 * collapsing their ids into ONE list + KPI refetch avoids a refetch-per-row
 * storm. Separate from the notifier's OWN toast coalesce: this is list-only.
 */
export const ORDERS_REALTIME_REFRESH_DEBOUNCE_MS = 1_500;

/**
 * Refetch the orders list + KPI summary when orders of a completed business day
 * arrive over Realtime (a midnight buffer graduation, a late arrival). The
 * live-performance notifier publishes each such id onto the recent-orders bus;
 * today's inserts are never published, because the list hides them until the
 * day ends. Subscribing to an external pub/sub is exactly what `useEffect` is for.
 *
 * `onRefresh` is the SAME invalidation the page runs on `onFlowsSettled`
 * (useRefreshOrders) — passed in and reused, never duplicated. Debounced so a
 * burst of ids coalesces into a single refetch; a ref keeps the subscription
 * stable across the callback's changing identity, so the channel is never torn
 * down and rebuilt on an unrelated re-render.
 */
export function useOrdersRealtimeRefresh(onRefresh: () => void): void {
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = subscribeCompletedDayOrders(() => {
      // Leading-guard coalesce: the first id opens a single window; ids that land
      // inside it fold into the one trailing refetch instead of scheduling their
      // own. Mirrors the notifier's scheduleInvalidate debounce.
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        onRefreshRef.current();
      }, ORDERS_REALTIME_REFRESH_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
