import { Decimal } from 'decimal.js';

/** Thrown when a parcel amount cannot be split across items (bad total or weights). */
export class InvalidAllocationError extends Error {}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const ONE_CENT = new Decimal('0.01');
const CENTS_PER_UNIT = 100;
const MAX_MONEY_DECIMALS = 2;

/** A per-item intermediate: its floored share and the fractional remainder dropped by flooring. */
interface WeightedPart {
  readonly floorValue: Decimal;
  readonly fraction: Decimal;
}

function assertSplittable(total: Decimal, weights: readonly Decimal[]): void {
  if (total.lt(ZERO)) {
    throw new InvalidAllocationError('total must not be negative');
  }
  if (total.decimalPlaces() > MAX_MONEY_DECIMALS) {
    throw new InvalidAllocationError('total must not have more than two decimals');
  }
  if (weights.length === 0) {
    throw new InvalidAllocationError('weights must not be empty');
  }
  for (const weight of weights) {
    if (weight.lt(ZERO)) {
      throw new InvalidAllocationError('weights must not be negative');
    }
  }
}

/**
 * Splits a rounded monetary total across weighted items down to the cent, so the
 * parts sum back exactly to the total (largest-remainder method). When every weight
 * is zero the total is split equally. The spare cents left by flooring each share go
 * to the largest fractional remainders first; ties go to the smaller index first
 * (plan decision 6). Cent counting stays in Decimal end to end -- the remainder is
 * compared, never coerced to a JS number.
 */
export function splitByWeights(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  assertSplittable(total, weights);

  const weightSum = weights.reduce((acc, weight) => acc.add(weight), ZERO);
  const useEqual = weightSum.isZero();
  const effectiveWeights = useEqual ? weights.map(() => ONE) : weights;
  const effectiveSum = useEqual ? new Decimal(weights.length) : weightSum;

  const parts: WeightedPart[] = effectiveWeights.map((weight) => {
    const raw = total.mul(weight).div(effectiveSum);
    const floorValue = raw.toDecimalPlaces(MAX_MONEY_DECIMALS, Decimal.ROUND_DOWN);
    return { floorValue, fraction: raw.sub(floorValue) };
  });

  const flooredSum = parts.reduce((acc, part) => acc.add(part.floorValue), ZERO);
  const remainingCents = total.sub(flooredSum).mul(CENTS_PER_UNIT);

  const ranked = parts.map((part, index) => ({ fraction: part.fraction, index }));
  ranked.sort((a, b) => {
    const byFraction = b.fraction.comparedTo(a.fraction);
    if (byFraction !== 0) {
      return byFraction;
    }
    return a.index - b.index;
  });

  const bonusIndices = new Set<number>();
  let distributed = 0;
  for (const { index } of ranked) {
    if (!remainingCents.gt(distributed)) {
      break;
    }
    bonusIndices.add(index);
    distributed += 1;
  }

  return parts.map((part, index) =>
    bonusIndices.has(index) ? part.floorValue.add(ONE_CENT) : part.floorValue,
  );
}
