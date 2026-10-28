import { rangeBounds, type FilterRow } from '@/lib/advanced-filter';

import type { ListProductsArgs, ProductStatusFilter } from '../api/list-products.api';

import { isProductStatusFilter, type ProductsFilters } from './products-filter-parsers';

// Stable field keys for the products advanced-filter catalog. The catalog with
// localized labels + facet-driven brand/category options is built in
// useProductFilterFields() (a hook, needs next-intl + facet data); these keys
// are the contract the translator below maps to backend query params.
export const PRODUCT_FILTER_FIELDS = {
  salePrice: 'salePrice',
  stock: 'stock',
  vatRate: 'vatRate',
  brand: 'brand',
  category: 'category',
  status: 'status',
} as const;

// The advanced-filter slice of ListProductsArgs. Since the quick facet chips
// were retired, ALL filter dimensions (including the single-value status)
// travel through FilterRow[]; only q / productId / overrideMissing remain as
// separate URL params.
export interface AdvancedProductParams {
  salePriceMin?: string;
  salePriceMax?: string;
  stockMin?: number;
  stockMax?: number;
  vatRateIn?: string;
  brandIdIn?: string;
  categoryIdIn?: string;
  status?: ProductStatusFilter;
}

// FilterRow[] -> backend query params. Pure: chips with no usable value
// contribute nothing. Multi-selects join to comma-separated strings (the wire
// format the backend csvParam expects). Range bounds come from rangeBounds()
// so operator semantics (between/gte/lte/eq) are handled in one place.
export function filterRowsToProductParams(rows: FilterRow[]): AdvancedProductParams {
  const params: AdvancedProductParams = {};
  for (const row of rows) {
    switch (row.field) {
      case PRODUCT_FILTER_FIELDS.salePrice: {
        const [min, max] = rangeBounds(row);
        if (min !== undefined) params.salePriceMin = min;
        if (max !== undefined) params.salePriceMax = max;
        break;
      }
      case PRODUCT_FILTER_FIELDS.stock: {
        const [min, max] = rangeBounds(row);
        const minN = min === undefined ? undefined : Number(min);
        const maxN = max === undefined ? undefined : Number(max);
        if (minN !== undefined && Number.isFinite(minN)) params.stockMin = minN;
        if (maxN !== undefined && Number.isFinite(maxN)) params.stockMax = maxN;
        break;
      }
      case PRODUCT_FILTER_FIELDS.vatRate: {
        const joined = multiValue(row);
        if (joined.length > 0) params.vatRateIn = joined.join(',');
        break;
      }
      case PRODUCT_FILTER_FIELDS.brand: {
        const joined = multiValue(row);
        if (joined.length > 0) params.brandIdIn = joined.join(',');
        break;
      }
      case PRODUCT_FILTER_FIELDS.category: {
        const joined = multiValue(row);
        if (joined.length > 0) params.categoryIdIn = joined.join(',');
        break;
      }
      case PRODUCT_FILTER_FIELDS.status: {
        // enumSingle: one status only. No status row means no status param,
        // so the backend default listing scope (not delisted, not archived)
        // applies.
        const value = Array.isArray(row.value) ? row.value[0] : row.value;
        if (value !== undefined && isProductStatusFilter(value)) params.status = value;
        break;
      }
    }
  }
  return params;
}

/**
 * The products page URL state -> the products list request. Search and the
 * deep-link product id are sent only when non-empty; the status comes ONLY
 * from a status chip. The page never injects a default status: without one
 * the backend lists its default scope (not delisted, not archived), which is
 * also the scope the tab and summary counts use.
 */
export function filtersToListProductsArgs(
  orgId: string,
  storeId: string,
  filters: ProductsFilters,
): ListProductsArgs {
  return {
    orgId,
    storeId,
    q: filters.q.length > 0 ? filters.q : undefined,
    productId: filters.productId.length > 0 ? filters.productId : undefined,
    overrideMissing: filters.overrideMissing ?? undefined,
    ...filterRowsToProductParams(filters.filters),
    page: filters.page,
    perPage: filters.perPage,
    sort: filters.sort,
  };
}

function multiValue(row: FilterRow): string[] {
  return Array.isArray(row.value) ? row.value.filter((v) => v.trim().length > 0) : [];
}
