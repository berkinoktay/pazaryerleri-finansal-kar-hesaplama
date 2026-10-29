import { Decimal } from 'decimal.js';

import { type AllocationBasis } from '../catalog/profit-line-catalog';

const ONE = new Decimal(1);

/** One item's share inputs: its sale gross and, when known, its standalone amount. */
export interface AllocationItem {
  readonly orderItemId: string;
  readonly saleGross: Decimal;
  readonly standaloneAmount: Decimal | null;
}

/** The resolved weights plus the basis actually used (may differ from the requested one). */
export interface ResolvedAllocationWeights {
  readonly weights: Decimal[];
  readonly basisUsed: AllocationBasis;
}

function saleShareWeights(items: readonly AllocationItem[]): Decimal[] {
  return items.map((item) => item.saleGross);
}

/**
 * Turns an allocation basis into per-item weights. `EQUAL` gives every item a weight
 * of one; `SALE_SHARE` weights by sale gross; `STANDALONE_AMOUNT` weights by each
 * item's standalone amount, but falls back to sale share (and reports it in
 * `basisUsed`) the moment a single item has no standalone amount.
 */
export function resolveAllocationWeights(
  basis: AllocationBasis,
  items: readonly AllocationItem[],
): ResolvedAllocationWeights {
  switch (basis) {
    case 'EQUAL':
      return { weights: items.map(() => ONE), basisUsed: 'EQUAL' };
    case 'SALE_SHARE':
      return { weights: saleShareWeights(items), basisUsed: 'SALE_SHARE' };
    case 'STANDALONE_AMOUNT': {
      const standalone: Decimal[] = [];
      for (const item of items) {
        if (item.standaloneAmount === null) {
          return { weights: saleShareWeights(items), basisUsed: 'SALE_SHARE' };
        }
        standalone.push(item.standaloneAmount);
      }
      return { weights: standalone, basisUsed: 'STANDALONE_AMOUNT' };
    }
    default: {
      const _exhaustive: never = basis;
      throw new Error(`Unhandled allocation basis: ${_exhaustive}`);
    }
  }
}
