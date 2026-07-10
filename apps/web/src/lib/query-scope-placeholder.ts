/**
 * A React Query `placeholderData` that keeps the previous page on screen ONLY
 * while the active store is unchanged.
 *
 * Store-scoped list queries carry `storeId` in their key. `placeholderData:
 * (prev) => prev` keeps the previous rows across ANY key change — including a
 * store switch — which momentarily paints one store's data on another store's
 * screen (the store-isolation UX hazard). This variant keeps the previous page
 * only when the previous query was for the SAME store (its key still contains
 * `storeId`); on a store switch it returns `undefined`, so the table falls back
 * to its skeleton instead of flashing the old store's rows.
 *
 * Within one store, pagination / tab / filter changes still keep the previous
 * page for a smooth, non-collapsing table — the reason `placeholderData` was
 * used in the first place.
 *
 * `storeId` is a uuid, so a false "same store" match (another key element equal
 * to it) is not a practical concern.
 */
export function keepPreviousWithinStore<TData>(
  storeId: string,
): (
  previous: TData | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
) => TData | undefined {
  return (previous, previousQuery) => {
    if (previous === undefined || previousQuery === undefined) return previous;
    return previousQuery.queryKey.includes(storeId) ? previous : undefined;
  };
}
