/**
 * Shared row discriminated union for the products table.
 *
 * Lives here (not in products-table.tsx) so it can be imported by
 * products-bulk-cost-action-bar.tsx without creating a circular dependency.
 */

import type { ProductWithVariants, VariantSummary } from '../api/list-products.api';

export type ProductRow =
  | { kind: 'parent'; product: ProductWithVariants }
  | { kind: 'variant'; parent: ProductWithVariants; variant: VariantSummary };
