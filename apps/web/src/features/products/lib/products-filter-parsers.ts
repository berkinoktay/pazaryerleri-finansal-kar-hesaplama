import { parseAsInteger, parseAsJson, parseAsString, parseAsStringEnum } from 'nuqs';

import { parseFilterRows, type FilterRow } from '@/lib/advanced-filter';

// Single source of truth for the URL ↔ React Query state binding on
// the products page. Mirrors the backend's ListProductsQuerySchema —
// when the backend gains a new filter, add the parser here and the
// rest of the page reacts automatically.

export const PRODUCT_VARIANT_STATUSES = ['onSale', 'archived', 'locked', 'blacklisted'] as const;
export type ProductVariantStatus = (typeof PRODUCT_VARIANT_STATUSES)[number];

export const PRODUCT_OVERRIDE_MISSING = ['cost', 'vat'] as const;
export type ProductOverrideMissing = (typeof PRODUCT_OVERRIDE_MISSING)[number];

export const PRODUCT_LIST_SORTS_EXTENDED = [
  // Default — newest listings first, matching the Trendyol seller-panel
  // ordering. See apps/api/src/validators/product.validator.ts for the
  // backend's matching enum.
  '-platformCreatedAt',
  'platformCreatedAt',
  '-platformModifiedAt',
  'platformModifiedAt',
  'title',
  '-title',
  'salePrice',
  '-salePrice',
  'totalStock',
  '-totalStock',
] as const;
export type ProductListSortExtended = (typeof PRODUCT_LIST_SORTS_EXTENDED)[number];

export const PRODUCT_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export const productsFiltersParsers = {
  q: parseAsString.withDefault(''),
  status: parseAsStringEnum<ProductVariantStatus>([...PRODUCT_VARIANT_STATUSES]).withDefault(
    'onSale',
  ),
  brandId: parseAsString.withDefault(''),
  categoryId: parseAsString.withDefault(''),
  // Deep-link filter — empty string means "no productId filter active".
  // Set from feature pages (cost-profile detail → "Bağlı varyantlar") so
  // the seller lands on the products page with a single product visible.
  productId: parseAsString.withDefault(''),
  // Absent from URL → null. Present and one of 'cost' | 'vat' → that value.
  // Present but invalid → null (nuqs default behavior). Don't .withDefault()
  // — we want null as the "no override-tab active" signal, distinct from
  // the implicit default for required fields.
  overrideMissing: parseAsStringEnum<ProductOverrideMissing>([...PRODUCT_OVERRIDE_MISSING]),
  // Advanced Filtering (PR-F1): the whole FilterRow[] rides one URL param as
  // JSON, separate from the single-value facet params above. parseFilterRows
  // drops malformed entries so a stale/hostile URL degrades to "no filters".
  filters: parseAsJson<FilterRow[]>(parseFilterRows).withDefault([]),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(25),
  sort: parseAsStringEnum<ProductListSortExtended>([...PRODUCT_LIST_SORTS_EXTENDED]).withDefault(
    '-platformCreatedAt',
  ),
};

export interface ProductsFilters {
  q: string;
  status: ProductVariantStatus;
  brandId: string;
  categoryId: string;
  productId: string;
  overrideMissing: ProductOverrideMissing | null;
  filters: FilterRow[];
  page: number;
  perPage: number;
  sort: ProductListSortExtended;
}
