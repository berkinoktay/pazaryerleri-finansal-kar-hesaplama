import { Decimal } from 'decimal.js';
import { ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { itemsForAllocation, type AllocationItemSets } from '../allocation-item-sets';
import { type AllocationItem } from '../allocation-weights';

const activeA: AllocationItem = {
  orderItemId: 'a',
  saleGross: new Decimal('100.00'),
  standaloneAmount: new Decimal('30.00'),
};
const activeB: AllocationItem = {
  orderItemId: 'b',
  saleGross: new Decimal('200.00'),
  standaloneAmount: new Decimal('40.00'),
};
const returnedA: AllocationItem = {
  orderItemId: 'a',
  saleGross: new Decimal('50.00'),
  standaloneAmount: new Decimal('30.00'),
};

describe('itemsForAllocation', () => {
  it('uses the returned items for a return-leg type', () => {
    const sets: AllocationItemSets = {
      activeItems: [activeA, activeB],
      returnedItems: [returnedA],
    };
    expect(itemsForAllocation(ProfitLineType.RETURN_SHIPPING, sets)).toEqual([returnedA]);
  });

  it('falls back to the active items when no returned item is known', () => {
    const sets: AllocationItemSets = {
      activeItems: [activeA, activeB],
      returnedItems: [],
    };
    expect(itemsForAllocation(ProfitLineType.RETURN_SHIPPING, sets)).toEqual([activeA, activeB]);
  });

  it('uses the active items for every other type', () => {
    const sets: AllocationItemSets = {
      activeItems: [activeA, activeB],
      returnedItems: [returnedA],
    };
    expect(itemsForAllocation(ProfitLineType.SHIPPING, sets)).toEqual([activeA, activeB]);
    expect(itemsForAllocation(ProfitLineType.SERVICE_FEE, sets)).toEqual([activeA, activeB]);
  });
});
