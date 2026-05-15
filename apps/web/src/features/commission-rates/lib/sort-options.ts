import type { CommissionRateProductScope, CommissionRateSort } from '../query-keys';

// Centralised sort vocabulary for the commission-rates table. Mapping
// (column, direction) → backend sort string keeps the table's column
// click-handlers free of string assembly and gives `resolveSortIntent`
// one place to enforce the product_count→active invariant.

export type SortableColumn = 'categoryName' | 'baseRate' | 'productCount';
export type SortDirection = 'asc' | 'desc';

const SORT_LOOKUP: Record<SortableColumn, Partial<Record<SortDirection, CommissionRateSort>>> = {
  categoryName: { asc: 'category_name:asc' },
  baseRate: { asc: 'base_rate:asc', desc: 'base_rate:desc' },
  productCount: { desc: 'product_count:desc' },
};

export function parseSort(sort: CommissionRateSort): {
  column: SortableColumn;
  direction: SortDirection;
} {
  switch (sort) {
    case 'category_name:asc':
      return { column: 'categoryName', direction: 'asc' };
    case 'base_rate:asc':
      return { column: 'baseRate', direction: 'asc' };
    case 'base_rate:desc':
      return { column: 'baseRate', direction: 'desc' };
    case 'product_count:desc':
      return { column: 'productCount', direction: 'desc' };
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unhandled sort value: ${String(_exhaustive)}`);
    }
  }
}

export interface ResolveSortIntentInput {
  column: SortableColumn;
  currentSort: CommissionRateSort;
  productScope: CommissionRateProductScope;
}

export interface ResolveSortIntentResult {
  sort: CommissionRateSort;
  productScope: CommissionRateProductScope;
  /** True when the request forced a productScope flip from `all` → `active`. */
  autoSwitchedScope: boolean;
}

/**
 * Computes the next (sort, productScope) tuple for a click on a column
 * header. Encodes two rules:
 *
 *   1. Toggling: clicking the currently sorted `baseRate` column flips
 *      asc ↔ desc; first-time clicks on a column use the default
 *      direction declared in SORT_LOOKUP.
 *   2. Scope invariant: `product_count:desc` requires
 *      productScope='active'. Clicking productCount in `all` mode
 *      auto-switches scope (Q4 decision in the design plan) — the
 *      caller surfaces a toast when `autoSwitchedScope` is true.
 */
export function resolveSortIntent({
  column,
  currentSort,
  productScope,
}: ResolveSortIntentInput): ResolveSortIntentResult {
  const directions = SORT_LOOKUP[column];
  const current = parseSort(currentSort);
  const nextDirection: SortDirection =
    column === 'baseRate' && current.column === 'baseRate' && current.direction === 'asc'
      ? 'desc'
      : column === 'baseRate'
        ? 'asc'
        : (Object.keys(directions)[0] as SortDirection);
  const nextSort = directions[nextDirection];
  if (nextSort === undefined) {
    throw new Error(`No sort defined for ${column}:${nextDirection}`);
  }
  const requiresActiveScope = nextSort === 'product_count:desc';
  const autoSwitchedScope = requiresActiveScope && productScope !== 'active';
  return {
    sort: nextSort,
    productScope: requiresActiveScope ? 'active' : productScope,
    autoSwitchedScope,
  };
}
