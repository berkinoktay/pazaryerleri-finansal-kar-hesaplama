// Shared Trendyol conventions -- single source of truth (#300).

import { Decimal } from 'decimal.js';

/**
 * Divisor that reduces a VAT-inclusive commission amount to its net: `1 + rate/100`.
 * The rate comes from the DB (resolveFeeDefinition().defaultVatRate) -- single
 * point, never repeat `1 + rate/100` locally.
 */
export function commissionVatDivisor(rate: Decimal.Value): Decimal {
  return new Decimal(1).add(new Decimal(rate).div(100));
}
