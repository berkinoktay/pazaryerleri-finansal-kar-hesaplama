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
