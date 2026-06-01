import { rangeBounds, type FilterRow } from '@/lib/advanced-filter';

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
} as const;

// The advanced-filter slice of ListProductsArgs (the PR-B2 params). Merged with
// the single-value facet params (q/status/brandId/...) when building the query.
export interface AdvancedProductParams {
  salePriceMin?: string;
  salePriceMax?: string;
  stockMin?: number;
  stockMax?: number;
  vatRateIn?: string;
  brandIdIn?: string;
  categoryIdIn?: string;
}

// FilterRow[] → backend query params. Pure: chips with no usable value
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
    }
  }
  return params;
}

function multiValue(row: FilterRow): string[] {
  return Array.isArray(row.value) ? row.value.filter((v) => v.trim().length > 0) : [];
}
