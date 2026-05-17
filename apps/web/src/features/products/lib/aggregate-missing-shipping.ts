import type { ProductWithVariants } from '../api/list-products.api';
import type { MissingShippingCounts } from '../components/missing-shipping-banner';

/**
 * Sum the visible page's non-OK shipping estimate statuses into the
 * four buckets the banner renders.
 *
 * Bucket policy (V1):
 *   - NO_DESI            → noDesi
 *   - NO_CARRIER         → noCarrier
 *   - OWN_CONTRACT_EMPTY → noCarrier (the seller has no usable carrier
 *                          path in V1, so it rolls into the same fix
 *                          surface — store settings)
 *   - DESI_OVERFLOW      → overflow
 *
 * Counts variants directly (not parent rows) — a multi-variant product
 * with mixed statuses contributes to multiple buckets, mirroring the
 * per-variant cell rendering.
 */
export function aggregateMissingShipping(products: ProductWithVariants[]): MissingShippingCounts {
  const counts: MissingShippingCounts = { total: 0, noDesi: 0, noCarrier: 0, overflow: 0 };
  for (const product of products) {
    for (const variant of product.variants) {
      const status = variant.shippingEstimateStatus;
      if (status === 'OK') continue;
      counts.total += 1;
      if (status === 'NO_DESI') {
        counts.noDesi += 1;
      } else if (status === 'NO_CARRIER' || status === 'OWN_CONTRACT_EMPTY') {
        counts.noCarrier += 1;
      } else if (status === 'DESI_OVERFLOW') {
        counts.overflow += 1;
      }
    }
  }
  return counts;
}
