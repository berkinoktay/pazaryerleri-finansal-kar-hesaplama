// Shared Trendyol conventions — single source of truth (#300).

import { Decimal } from 'decimal.js';

/**
 * Trendyol commission VAT is 20% by convention (design §12.2 #1). V1
 * assumption — once `fatura-entegrasyonu/` docs are read this becomes
 * empirically verifiable; until then the invoice surface has been
 * consistent (research §3.1).
 *
 * Consumers: the order-sync mapper (orders.ts) and the settlement
 * handlers (sale / discount / return in apps/sync-worker) all split the
 * KDV-dahil commission with this convention. Rate and divisor are two
 * views of the same constant — never redeclare locally.
 */
export const TRENDYOL_COMMISSION_VAT_RATE = 20;

/** Divide a KDV-dahil commission amount by this to get NET (= 1.20). */
export const TRENDYOL_COMMISSION_VAT_DIVISOR = new Decimal(TRENDYOL_COMMISSION_VAT_RATE)
  .div(100)
  .add(1);
