import { rangeBounds, type FilterRow } from '@/lib/advanced-filter';

import { PRODUCT_VARIANT_STATUSES, type ProductVariantStatus } from './products-filter-parsers';

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
  status?: ProductVariantStatus;
}

function isProductVariantStatus(value: string): value is ProductVariantStatus {
  return (PRODUCT_VARIANT_STATUSES as readonly string[]).includes(value);
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
      case PRODUCT_FILTER_FIELDS.status: {
        // enumSingle — one status only. No status row means the caller's
        // default view scope applies ('onSale', set at the call site).
        const value = Array.isArray(row.value) ? row.value[0] : row.value;
        if (value !== undefined && isProductVariantStatus(value)) params.status = value;
        break;
      }
    }
  }
  return params;
}

function multiValue(row: FilterRow): string[] {
  return Array.isArray(row.value) ? row.value.filter((v) => v.trim().length > 0) : [];
}
