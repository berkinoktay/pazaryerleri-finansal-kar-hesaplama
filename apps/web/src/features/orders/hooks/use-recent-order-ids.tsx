'use client';

import * as React from 'react';

import { subscribeRecentOrders } from '@/lib/recent-orders-bus';

/**
 * How long a freshly-arrived order id stays "recent" — long enough to cover the
 * list refetch that brings the new row on-screen and its ~3s highlight fade,
 * then it drops so the flash never re-arms on a later unrelated re-render.
 */
export const RECENT_ORDER_TTL_MS = 5_000;

// Default: an empty set, so `useRecentOrderIds()` is safe to call outside the
// provider (e.g. the OrdersTable in isolation / tests) — it simply never
// highlights. Frozen so a caller can't mutate the shared default.
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

const RecentOrderIdsContext = React.createContext<ReadonlySet<string>>(EMPTY_IDS);

/**
 * Holds the ids of orders that arrived over Realtime in the last
 * RECENT_ORDER_TTL_MS, fed by the new-order notifier via the recent-orders bus.
 * The OrdersTable reads this set to flash matching rows (issue #467). Each id
 * self-expires on its own timer; the flash only ever paints a row that is
 * actually in the list, because the id-match gates it naturally.
 *
 * Subscribing to an external pub/sub is exactly what `useEffect` is for.
 */
export function RecentOrderIdsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(EMPTY_IDS);

  React.useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const drop = (orderId: string): void => {
      timers.delete(orderId);
      setIds((prev) => {
        if (!prev.has(orderId)) return prev;
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    };

    const unsubscribe = subscribeRecentOrders((orderId) => {
      setIds((prev) => {
        if (prev.has(orderId)) return prev;
        const next = new Set(prev);
        next.add(orderId);
        return next;
      });
      // Restart the id's TTL on a repeat so a re-announced order keeps flashing.
      const existing = timers.get(orderId);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        orderId,
        setTimeout(() => drop(orderId), RECENT_ORDER_TTL_MS),
      );
    });

    return () => {
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return <RecentOrderIdsContext.Provider value={ids}>{children}</RecentOrderIdsContext.Provider>;
}

/** The set of order ids that arrived in the last RECENT_ORDER_TTL_MS. */
export function useRecentOrderIds(): ReadonlySet<string> {
  return React.useContext(RecentOrderIdsContext);
}
