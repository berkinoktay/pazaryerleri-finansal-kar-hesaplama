import type { CostStatus, ShippingEstimateStatus } from '../validators/product.validator';

export type CommissionStatus = 'OK' | 'NO_RULE';

export { type CostStatus, type ShippingEstimateStatus };

/**
 * Per-variant forward pricing row served by `listProductPricing`. Rows are
 * ALWAYS returned (calculable or not) so the user sees the gaps that block a
 * profit calculation. The three independent status fields surface WHICH input
 * is missing; `calculable` is their conjunction (`deriveCalculable`). Money +
 * margin fields are serialized as decimal strings (never float) and are `null`
 * exactly when `calculable` is false.
 */
export interface ProductPricingRow {
  variantId: string;
  sku: string;
  barcode: string;
  productName: string;
  salePrice: string;
  costStatus: CostStatus;
  shippingEstimateStatus: ShippingEstimateStatus;
  commissionStatus: CommissionStatus;
  calculable: boolean;
  netProfit: string | null;
  saleMarginPct: string | null;
  costMarkupPct: string | null;
}
