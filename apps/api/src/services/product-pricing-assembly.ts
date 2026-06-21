import { Decimal } from 'decimal.js';

import { grossToVat, type ProfitInputFee } from '@pazarsync/profit';

import type { CommissionStatus, CostStatus, ShippingEstimateStatus } from './product-pricing.types';

/** NET ucret -> GROSS DEBIT ProfitInputFee (kargo/PSF). vatRatePct yuzde (orn. 20). */
export function feeToProfitInputFee(
  netAmount: Decimal,
  vatRatePct: Decimal,
  type: 'SHIPPING' | 'PLATFORM_SERVICE',
): ProfitInputFee {
  const gross = netAmount.mul(new Decimal(100).add(vatRatePct)).div(100).toDecimalPlaces(2);
  return { type, gross, vat: grossToVat(gross, vatRatePct), direction: 'DEBIT' };
}

/** Uc bagimsiz durum da OK ise varyant kar-hesaplanabilir. */
export function deriveCalculable(
  costStatus: CostStatus,
  shippingStatus: ShippingEstimateStatus,
  commissionStatus: CommissionStatus,
): boolean {
  return costStatus === 'OK' && shippingStatus === 'OK' && commissionStatus === 'OK';
}
