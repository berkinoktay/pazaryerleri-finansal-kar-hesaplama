import type { ProductPricingItem } from '../api/list-product-pricing.api';

/**
 * Which missing input a row's status chip flags. The Durum cell is QUIET
 * when a row is calculable — the presence of profit numbers is the signal,
 * so a calculable row resolves to `null` (no chip). A non-calculable row
 * names the FIRST missing input in precedence order (cost → shipping →
 * commission) so the seller knows which gap to close. One chip per row
 * keeps the column scannable.
 */
export type PricingStatusKind = 'cost' | 'shipping' | 'commission';

/**
 * Discriminated descriptor for a flagged (non-calculable) row: the headline
 * chip `kind`, plus the precise sub-status enum value tagged by its `group`
 * so the component can look the detail copy up against a group-scoped (and
 * statically typed) translator — no dynamic dotted i18n key. Calculable rows
 * resolve to `null` and render nothing.
 */
export type PricingStatusDescriptor =
  | { kind: 'cost'; group: 'cost'; detail: ProductPricingItem['costStatus'] }
  | { kind: 'shipping'; group: 'shipping'; detail: ProductPricingItem['shippingEstimateStatus'] }
  | { kind: 'commission'; group: 'commission'; detail: ProductPricingItem['commissionStatus'] };

/**
 * Resolves the row's flagged status chip plus its precise sub-status, or
 * `null` when the row is calculable (quiet — no chip). Pure — no rendering,
 * no translation; the component maps `kind` → warning tone+label and the
 * `group`/`detail` pair → tooltip copy.
 */
export function resolvePricingStatus(item: ProductPricingItem): PricingStatusDescriptor | null {
  if (item.calculable) {
    return null;
  }
  if (item.costStatus !== 'OK') {
    return { kind: 'cost', group: 'cost', detail: item.costStatus };
  }
  if (item.shippingEstimateStatus !== 'OK') {
    return { kind: 'shipping', group: 'shipping', detail: item.shippingEstimateStatus };
  }
  return { kind: 'commission', group: 'commission', detail: item.commissionStatus };
}
