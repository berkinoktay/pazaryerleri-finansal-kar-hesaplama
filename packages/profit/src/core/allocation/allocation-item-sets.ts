import { type ProfitLineType } from '@pazarsync/db/enums';

import { getLineSpec } from '../catalog/profit-line-catalog';
import { type AllocationItem } from './allocation-weights';

/**
 * The two item sets a parcel can allocate a line across: the items that are still
 * active (the forward legs) and the items that were returned (the return legs).
 */
export interface AllocationItemSets {
  readonly activeItems: readonly AllocationItem[];
  readonly returnedItems: readonly AllocationItem[];
}

/**
 * The items a parcel-level line of `type` is shared across, read from the catalog's
 * `allocationScope` (never a hard-coded type list). A return-leg line uses the
 * returned items, but falls back to the active items while no return is known yet:
 * a return-shipping invoice can arrive before the accepted return is recorded. Every
 * other line uses the active items.
 */
export function itemsForAllocation(
  type: ProfitLineType,
  sets: AllocationItemSets,
): readonly AllocationItem[] {
  const scope = getLineSpec(type).allocationScope;
  switch (scope) {
    case 'RETURNED_ITEMS':
      return sets.returnedItems.length === 0 ? sets.activeItems : sets.returnedItems;
    case 'ACTIVE_ITEMS':
      return sets.activeItems;
    default: {
      const _exhaustive: never = scope;
      throw new Error(`Unhandled allocation scope: ${_exhaustive}`);
    }
  }
}
