import type { ProductsEmptyStateVariant } from '../components/products-empty-state';

import type { ProductOverrideMissing } from './products-filter-parsers';

// The all-clear empty state of each override tab. A Record over the union, so
// a new override tab fails the typecheck until it names its empty state.
const OVERRIDE_ALL_CLEAR_VARIANT: Record<ProductOverrideMissing, ProductsEmptyStateVariant> = {
  cost: 'missing-cost-none',
  desi: 'missing-desi-none',
};

export interface ProductsEmptyVariantInput {
  /** The list finished loading and returned no rows. */
  isEmptyAfterLoad: boolean;
  /** The server's row count for the whole filtered list, not just this page. */
  total: number;
  overrideMissing: ProductOverrideMissing | null;
  /** A search term or an advanced-filter chip narrows the list. */
  hasActiveSearchOrFilter: boolean;
}

/**
 * Which empty state the products table shows, or undefined while it has rows.
 * An active search or filter wins over the override tab: an empty missing-cost
 * tab under a search only means "nothing matched", so the seller gets the
 * filtered no-results state with its "Clear filters" button. The tab's
 * all-clear copy ("every product has a cost") shows only when nothing else
 * narrows the list, because only then is it true.
 *
 * An empty page of a non-empty list (total > 0) is a page past the last one;
 * no empty-state copy is true for it, and the page client steps back to the
 * last page (see pageToStepBackTo).
 */
export function resolveProductsEmptyVariant({
  isEmptyAfterLoad,
  total,
  overrideMissing,
  hasActiveSearchOrFilter,
}: ProductsEmptyVariantInput): ProductsEmptyStateVariant | undefined {
  if (!isEmptyAfterLoad || total > 0) return undefined;
  if (hasActiveSearchOrFilter) return 'filtered';
  if (overrideMissing !== null) return OVERRIDE_ALL_CLEAR_VARIANT[overrideMissing];
  return 'no-products';
}

export interface PageToStepBackToInput {
  /** The page the URL asks for. */
  page: number;
  /** Rows the server returned for that page. */
  rowCount: number;
  /** The server's page count for the whole filtered list. */
  totalPages: number;
}

/**
 * The last page to move to when the requested page came back empty although
 * the list still has rows, or null when the page is fine. This happens when
 * the seller empties the last page of an override tab: every saved cost or
 * desi drops its product from the tab, so the refetched page can lie past the
 * new last page. The backend echoes the requested page and does not clamp.
 */
export function pageToStepBackTo({
  page,
  rowCount,
  totalPages,
}: PageToStepBackToInput): number | null {
  if (rowCount > 0 || totalPages === 0 || page <= totalPages) return null;
  return totalPages;
}
