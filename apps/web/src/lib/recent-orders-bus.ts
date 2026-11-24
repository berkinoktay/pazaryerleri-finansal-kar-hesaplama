/**
 * A tiny module-singleton pub/sub for ids of `orders` rows INSERTED with a past
 * business date: a midnight buffer graduation or a late arrival. Those rows
 * belong on the orders page, which shows completed business days only. The
 * live-performance new-order notifier (the Realtime INSERT path) publishes each
 * such id here; the orders page subscribes and refetches its list and KPI
 * summary. Today's inserts are never published: the orders page hides them
 * until the day ends.
 *
 * A shared lib rather than a cross-feature import: the publisher lives in
 * `features/live-performance` and the subscriber in `features/orders`, so the
 * id crosses through this neutral seam instead of one feature reaching into the
 * other. It carries no React state, purely a synchronous fan-out.
 */
type CompletedDayOrderListener = (orderId: string) => void;

const listeners = new Set<CompletedDayOrderListener>();

/** Fan a completed-day order id out to every current subscriber. Fire-and-forget. */
export function publishCompletedDayOrder(orderId: string): void {
  for (const listener of listeners) listener(orderId);
}

/** Subscribe to completed-day order ids. Returns an unsubscribe function. */
export function subscribeCompletedDayOrders(listener: CompletedDayOrderListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
