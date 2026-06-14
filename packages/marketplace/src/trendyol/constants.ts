// Shared Trendyol conventions — single source of truth (#300).

import { Decimal } from 'decimal.js';

/**
 * Trendyol commission VAT default rate (%20).
 *
 * Denetim A (2026-06-14): the AUTHORITATIVE rate now lives in the DB as a
 * `fee_definitions` row (scope `ALL`, feeType `COMMISSION_INVOICE`,
 * `default_vat_rate`) so it changes without a deploy. Consumers (order mapper,
 * settlement handlers) resolve it via `resolveFeeDefinition` and pass it in.
 * This constant remains the FALLBACK default for callers that don't resolve
 * (webhook/test estimate paths) — the order intake estimate is reconciled by
 * settlement anyway. Rate and divisor: see `commissionVatDivisor`.
 */
export const TRENDYOL_COMMISSION_VAT_RATE = 20;

/**
 * KDV-dahil bir komisyon tutarını NET'e indirgemek için bölen: `1 + rate/100`.
 * Oran DB'den (resolveFeeDefinition().defaultVatRate) ya da
 * `TRENDYOL_COMMISSION_VAT_RATE` fallback'inden gelir — tek nokta, asla yerelde
 * `1 + rate/100` tekrarı yazma.
 */
export function commissionVatDivisor(rate: Decimal.Value): Decimal {
  return new Decimal(1).add(new Decimal(rate).div(100));
}
