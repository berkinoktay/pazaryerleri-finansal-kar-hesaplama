import type { LiveOrderRow } from '../api/get-live-orders.api';

/**
 * Resolve a deep-link param (`?order=` / `?buffer=`) to its row in today's
 * feed. Returns null while the feed is still loading or when the id is absent
 * (a stale link, or the row hasn't arrived/refetched yet).
 */
export function resolveDeepLinkRow(
  rows: readonly LiveOrderRow[] | undefined,
  orderParam: string | null,
  bufferParam: string | null,
): LiveOrderRow | null {
  if (rows === undefined) return null;
  if (orderParam === null && bufferParam === null) return null;
  return (
    rows.find(
      (r) =>
        (orderParam !== null && r.orderId === orderParam) ||
        (bufferParam !== null && r.bufferId === bufferParam),
    ) ?? null
  );
}
