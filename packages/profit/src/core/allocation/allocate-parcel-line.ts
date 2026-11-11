import { ProfitLineLevel } from '@pazarsync/db/enums';

import { type AllocationBasis, getLineSpec } from '../catalog/profit-line-catalog';
import { type LineMoney, type ProfitLine } from '../profit-line';
import { type AllocationItem, resolveAllocationWeights } from './allocation-weights';
import { InvalidAllocationError, splitByWeights } from './split-by-weights';

export { InvalidAllocationError } from './split-by-weights';

/** One item's share of a parcel-level line: its amount and the basis used to derive it. */
export interface ProfitLineAllocation {
  readonly orderItemId: string;
  readonly amount: LineMoney;
  readonly basisUsed: AllocationBasis;
}

/**
 * Splits a parcel-level line down to its items. The basis comes from the line type's
 * catalog spec; gross and VAT are split with the same weights but independently, so
 * each column sums back to the parcel total to the cent. Throws when the line is not
 * parcel-level or its type has no allocation basis.
 */
export function allocateParcelLine(
  line: ProfitLine,
  items: readonly AllocationItem[],
): ProfitLineAllocation[] {
  if (line.level !== ProfitLineLevel.PARCEL) {
    throw new InvalidAllocationError('allocateParcelLine requires a PARCEL-level line');
  }

  const basis = getLineSpec(line.type).allocationBasis;
  if (basis === null) {
    throw new InvalidAllocationError(`${line.type} has no allocation basis`);
  }

  const resolved = resolveAllocationWeights(basis, items);
  const grossParts = splitByWeights(line.amount.gross, resolved.weights);
  const vatParts = splitByWeights(line.amount.vat, resolved.weights);

  return items.map((item, index): ProfitLineAllocation => {
    const gross = grossParts[index];
    const vat = vatParts[index];
    if (gross === undefined || vat === undefined) {
      throw new InvalidAllocationError('allocation produced fewer parts than items');
    }
    return {
      orderItemId: item.orderItemId,
      amount: { gross, vat },
      basisUsed: resolved.basisUsed,
    };
  });
}
