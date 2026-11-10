// Pure change detection for the claims handler (claims.ts).
//
// The claims scan re-reads a 60-day window every few hours, so almost every claim it
// sees is unchanged. These helpers let the handler skip writing an unchanged row and
// skip enqueueing a profit recompute when nothing the profit engine reads moved.
//
// The profit engine reads exactly these claim fields (loadTrendyolParcel in
// packages/profit/src/persistence/load-trendyol-parcel.ts):
//   - claim.orderShipmentPackageId: the return package; binds return settlement rows.
//   - claim.cargoTrackingNumber: binds the return cargo-invoice item.
//   - item.status + item.orderItemId: an Accepted item linked to an order item is one
//     returned unit.
// The claim's order itself is also an input; a claim that is new to an order (created
// or re-anchored) is handled by the caller passing `stored = null`.

import type { MappedClaim } from '@pazarsync/marketplace';

/** The stored claim columns the profit engine reads, as the handler selects them. */
export interface StoredClaimForChange {
  readonly orderShipmentPackageId: string | null;
  readonly cargoTrackingNumber: bigint | null;
  readonly items: readonly {
    readonly trendyolClaimItemId: string;
    readonly status: string;
    readonly orderItemId: string | null;
  }[];
}

/**
 * Whether writing `incoming` over `stored` changes what the profit engine reads for the
 * claim's order. `resolvedLinks` maps each incoming claim item id to the order item this
 * scan resolved for it (null when it resolved none).
 *
 * Mirrors the write path's null-preserving update: a sparse scan that carries no return
 * package id, no tracking number, or no item link never blanks the stored value, so it
 * is not a change. A value that arrives and differs from the stored one is a change.
 */
export function claimProfitInputsChanged(
  stored: StoredClaimForChange | null,
  incoming: MappedClaim,
  resolvedLinks: ReadonlyMap<string, string | null>,
): boolean {
  if (stored === null) return true;

  if (
    incoming.orderShipmentPackageId !== null &&
    incoming.orderShipmentPackageId !== stored.orderShipmentPackageId
  ) {
    return true;
  }

  if (
    incoming.cargoTrackingNumber !== null &&
    (stored.cargoTrackingNumber === null ||
      BigInt(incoming.cargoTrackingNumber) !== stored.cargoTrackingNumber)
  ) {
    return true;
  }

  const storedItems = new Map(stored.items.map((item) => [item.trendyolClaimItemId, item]));
  for (const item of incoming.items) {
    const storedItem = storedItems.get(item.trendyolClaimItemId);
    if (storedItem === undefined) return true;
    if (storedItem.status !== item.status) return true;
    const link = resolvedLinks.get(item.trendyolClaimItemId) ?? null;
    if (link !== null && link !== storedItem.orderItemId) return true;
  }

  return false;
}

/**
 * The entries of `update` whose value differs from the same key of the stored row, so an
 * unchanged re-scan writes nothing (and leaves `updated_at` alone). Dates compare by
 * instant, bigints and other primitives by value, and JSON objects by content with keys
 * sorted, because Postgres jsonb hands keys back in its own order.
 */
export function pickChangedFields<T extends object>(
  update: T,
  stored: { readonly [K in keyof T]: unknown },
): Partial<T> {
  const changed: Partial<T> = {};
  for (const key in update) {
    if (!Object.hasOwn(update, key)) continue;
    if (!sameStoredValue(update[key], stored[key])) {
      changed[key] = update[key];
    }
  }
  return changed;
}

function sameStoredValue(next: unknown, stored: unknown): boolean {
  if (next instanceof Date || stored instanceof Date) {
    return next instanceof Date && stored instanceof Date && next.getTime() === stored.getTime();
  }
  if (isJsonObject(next) || isJsonObject(stored)) {
    return canonicalJson(next) === canonicalJson(stored);
  }
  return next === stored;
}

function isJsonObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isJsonObject(inner) && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}
