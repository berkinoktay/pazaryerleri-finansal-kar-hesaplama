'use client';

import * as React from 'react';

import { subscribeRecentOrders } from '@/lib/recent-orders-bus';

/**
 * Coalesce window for list refetches driven by Realtime order inserts. A sync
 * backfilling several of today's orders publishes a burst of ids back-to-back;
 * collapsing them into ONE list + KPI refetch avoids a refetch-per-row storm.
 * Separate from the #424 notifier's OWN toast coalesce — this is list-only.
 */
export const ORDERS_REALTIME_REFRESH_DEBOUNCE_MS = 1_500;

/**
 * Refetch the orders list + KPI summary when new orders arrive over Realtime.
 * The live-performance notifier publishes each genuinely-new order id onto the
 * recent-orders bus (#424/#467); without this the new row never enters the list
 * — the row stays invisible and its highlight arms against a row that was never
 * fetched. Subscribing to an external pub/sub is exactly what `useEffect` is for.
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

    const unsubscribe = subscribeRecentOrders(() => {
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
