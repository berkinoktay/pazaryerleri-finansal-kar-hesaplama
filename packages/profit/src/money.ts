import { Decimal } from 'decimal.js';

/**
 * gross × ratePct / (100 + ratePct) — KDV-dahil (GROSS) tutardan içerideki KDV'yi
 * çıkarır. `ratePct` yüzde değeridir (örn. 20 = %20). Tek doğruluk kaynağı;
 * paketteki tüm KDV türevleri buradan geçer.
 */
export function grossToVat(gross: Decimal, ratePct: Decimal): Decimal {
  return gross.mul(ratePct).div(new Decimal(100).add(ratePct));
}
