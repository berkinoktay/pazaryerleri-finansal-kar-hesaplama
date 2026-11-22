import type { LiveOrderRow } from '../api/get-live-orders.api';

/**
 * Keep the detail Sheet on the same sale when a pending (buffer) order is
 * promoted. Once its last missing input is entered, the worker writes the
 * order to `orders` and deletes the buffer entry, keeping `platformOrderId`
 * (apps/sync-worker/src/handlers/buffer-promote.ts). When the selected buffer
 * row has left today's feed, this returns the orders row with the same
 * `platformOrderId`; while neither is listed (the feed has not refetched yet)
 * it keeps the selection, so the Sheet never closes on its own.
 *
 * Returns `selected` unchanged when it is null, an orders row, or the rows are
 * still loading.
 */
export function followPromotedRow(
  rows: readonly LiveOrderRow[] | undefined,
  selected: LiveOrderRow | null,
): LiveOrderRow | null {
  if (selected === null || selected.source !== 'buffer' || rows === undefined) return selected;
  if (rows.some((r) => r.source === 'buffer' && r.bufferId === selected.bufferId)) return selected;
  return (
    rows.find((r) => r.source === 'orders' && r.platformOrderId === selected.platformOrderId) ??
    selected
  );
}
