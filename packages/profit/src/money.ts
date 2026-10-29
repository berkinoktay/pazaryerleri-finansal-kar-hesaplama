import { Decimal } from 'decimal.js';

/**
 * gross × ratePct / (100 + ratePct) — KDV-dahil (GROSS) tutardan içerideki KDV'yi
 * çıkarır. `ratePct` yüzde değeridir (örn. 20 = %20). Tek doğruluk kaynağı;
 * paketteki tüm KDV türevleri buradan geçer.
 */
export function grossToVat(gross: Decimal, ratePct: Decimal): Decimal {
  return gross.mul(ratePct).div(new Decimal(100).add(ratePct));
}

/**
 * Rounds a monetary value to two decimals using banker-free ROUND_HALF_UP
 * (ties away from zero). Single source of truth for money rounding: every line
 * amount passes through here exactly once before it enters a profit line.
 */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** A stored money amount is denominated in kurus: at most two decimal places. */
export const KURUS_DECIMALS = 2;

/**
 * Rounds a monetary value UP to two decimals (towards +infinity). The scenario
 * price solver rounds a solved price up to the next kurus so the asked target is
 * met rather than missed by a fraction of a kurus.
 */
export function ceilToKurus(value: Decimal): Decimal {
  return value.toDecimalPlaces(KURUS_DECIMALS, Decimal.ROUND_CEIL);
}

/**
 * Rounds a monetary value DOWN to two decimals (towards -infinity). The mirror of
 * `ceilToKurus`; used when a kurus boundary has to stay inside a price band.
 */
export function floorToKurus(value: Decimal): Decimal {
  return value.toDecimalPlaces(KURUS_DECIMALS, Decimal.ROUND_FLOOR);
}

/**
 * Checks a money amount against the three kurus invariants in order: finite,
 * non-negative, and no more than two decimals. Returns the first broken rule or
 * `null` when the value is a valid kurus amount. Single source of truth for the
 * money-amount shape: both `createProfitLine` and the parcel snapshot validator
 * phrase their own error messages from this result.
 */
export function kurusAmountViolation(
  value: Decimal,
): 'NOT_FINITE' | 'NEGATIVE' | 'TOO_MANY_DECIMALS' | null {
  if (!value.isFinite()) {
    return 'NOT_FINITE';
  }
  if (value.lt(0)) {
    return 'NEGATIVE';
  }
  if (value.decimalPlaces() > KURUS_DECIMALS) {
    return 'TOO_MANY_DECIMALS';
  }
  return null;
}
