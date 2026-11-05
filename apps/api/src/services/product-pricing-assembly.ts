import type { CommissionStatus, CostStatus, ShippingEstimateStatus } from './product-pricing.types';

/** A variant is profit-calculable only when all three independent statuses are OK. */
export function deriveCalculable(
  costStatus: CostStatus,
  shippingStatus: ShippingEstimateStatus,
  commissionStatus: CommissionStatus,
): boolean {
  return costStatus === 'OK' && shippingStatus === 'OK' && commissionStatus === 'OK';
}
