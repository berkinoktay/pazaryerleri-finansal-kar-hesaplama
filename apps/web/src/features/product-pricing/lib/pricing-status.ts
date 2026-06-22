import type { ProductPricingItem } from '../api/list-product-pricing.api';

/**
 * Which single status chip a row surfaces. A calculable row reads as
 * `ready`; otherwise the FIRST missing input in precedence order
 * (cost → shipping → commission) names the gap the seller must close.
 * One chip per row keeps the column scannable — the tooltip carries the
 * precise sub-status detail.
 */
export type PricingStatusKind = 'ready' | 'cost' | 'shipping' | 'commission';

/**
 * Discriminated descriptor: the headline chip `kind`, plus the precise
 * sub-status enum value tagged by its `group` so the component can look
 * the detail copy up against a group-scoped (and statically typed)
 * translator — no dynamic dotted i18n key.
 */
export type PricingStatusDescriptor =
  | { kind: 'ready' }
  | { kind: 'cost'; group: 'cost'; detail: ProductPricingItem['costStatus'] }
  | { kind: 'shipping'; group: 'shipping'; detail: ProductPricingItem['shippingEstimateStatus'] }
  | { kind: 'commission'; group: 'commission'; detail: ProductPricingItem['commissionStatus'] };

/**
 * Resolves the row's headline status chip plus its precise sub-status.
 * Pure — no rendering, no translation; the component maps `kind` →
 * tone+label and the `group`/`detail` pair → tooltip copy.
 */
export function resolvePricingStatus(item: ProductPricingItem): PricingStatusDescriptor {
  if (item.calculable) {
    return { kind: 'ready' };
  }
  if (item.costStatus !== 'OK') {
    return { kind: 'cost', group: 'cost', detail: item.costStatus };
  }
  if (item.shippingEstimateStatus !== 'OK') {
    return { kind: 'shipping', group: 'shipping', detail: item.shippingEstimateStatus };
  }
  return { kind: 'commission', group: 'commission', detail: item.commissionStatus };
}
