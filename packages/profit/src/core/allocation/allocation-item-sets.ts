import { type ProfitLineType } from '@pazarsync/db/enums';

import { getLineSpec } from '../catalog/profit-line-catalog';
import { type AllocationItem } from './allocation-weights';

/**
 * The item sets a parcel can allocate a line across: the items that are still active
 * (the forward legs), the items that were returned (the return legs), and every item
 * of the parcel (cancelled ones included). `allItems` is the last-resort fallback so
 * a parcel-level line is never left unallocated - a cancelled parcel's cargo invoice
 * has no active and no returned items, yet its actual shipping line must still split
 * down to the items it was shipped for.
 */
export interface AllocationItemSets {
  readonly activeItems: readonly AllocationItem[];
  readonly returnedItems: readonly AllocationItem[];
  readonly allItems: readonly AllocationItem[];
}

/**
 * The items a parcel-level line of `type` is shared across, read from the catalog's
 * `allocationScope` (never a hard-coded type list). Each scope falls back so no
 * parcel line is ever left unallocated:
 * - a return-leg line uses the returned items, falls back to the active items while
 *   no return is known yet (a return-shipping invoice can arrive before the accepted
 *   return is recorded), then to all items;
 * - a forward line uses the active items, falls back to all items.
 * A fallback item set still carries each item's real sale gross, so a sale-share line
 * splits across it by sale share; an equal split happens only when every weight is
 * zero. Either way the split sums back to the parcel total to the cent.
 */
export function itemsForAllocation(
  type: ProfitLineType,
  sets: AllocationItemSets,
): readonly AllocationItem[] {
  const scope = getLineSpec(type).allocationScope;
  switch (scope) {
    case 'RETURNED_ITEMS':
      if (sets.returnedItems.length > 0) {
        return sets.returnedItems;
      }
      return sets.activeItems.length > 0 ? sets.activeItems : sets.allItems;
    case 'ACTIVE_ITEMS':
      return sets.activeItems.length > 0 ? sets.activeItems : sets.allItems;
    default: {
      const _exhaustive: never = scope;
      throw new Error(`Unhandled allocation scope: ${_exhaustive}`);
    }
  }
}
