/**
 * A tiny module-singleton pub/sub for "an order just arrived" ids. The
 * live-performance new-order notifier (the #424 Realtime INSERT path) publishes
 * each genuinely-new order id here; the orders feature's RecentOrderIdsProvider
 * subscribes and holds them briefly to flash the new row (issue #467).
 *
 * A shared lib rather than a cross-feature import: the publisher lives in
 * `features/live-performance` and the subscriber in `features/orders`, so the
 * id crosses through this neutral seam instead of one feature reaching into the
 * other. It carries no React state — purely a synchronous fan-out.
 */
type RecentOrderListener = (orderId: string) => void;

const listeners = new Set<RecentOrderListener>();

/** Fan a newly-arrived order id out to every current subscriber. Fire-and-forget. */
export function publishRecentOrder(orderId: string): void {
  for (const listener of listeners) listener(orderId);
}

/** Subscribe to newly-arrived order ids. Returns an unsubscribe function. */
export function subscribeRecentOrders(listener: RecentOrderListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
