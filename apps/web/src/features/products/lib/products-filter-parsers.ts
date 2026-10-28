import { ProductVariantStatus } from '@pazarsync/db/enums';
import { parseAsInteger, parseAsJson, parseAsString, parseAsStringEnum } from 'nuqs';

import { parseFilterRows, type FilterRow } from '@/lib/advanced-filter';

import type { ProductStatusFilter } from '../api/list-products.api';

// Single source of truth for the URL ↔ React Query state binding on
// the products page. Mirrors the backend's ListProductsQuerySchema —
// when the backend gains a new filter, add the parser here and the
// rest of the page reacts automatically.

/**
 * Every value the products list `status` filter accepts, in display order:
 * each ProductVariantStatus ("in that status and still in the Trendyol feed")
 * followed by DELISTED ("removed from the feed", whatever the status). Sending
 * no status at all selects the backend default listing scope instead.
 */
export const PRODUCT_STATUS_FILTERS: readonly ProductStatusFilter[] = [
  ...Object.values(ProductVariantStatus),
  'DELISTED',
];

const PRODUCT_STATUS_FILTER_SET: ReadonlySet<string> = new Set(PRODUCT_STATUS_FILTERS);

/** Narrows a URL or chip value to a status the products list accepts. */
export function isProductStatusFilter(value: string): value is ProductStatusFilter {
  return PRODUCT_STATUS_FILTER_SET.has(value);
}

// Override tabs offered by the page: missing cost and missing desi (the VAT tab
// was retired: Trendyol sends a VAT rate for every variant). The list request
// types `overrideMissing` from the generated client, so an entry the backend
// does not accept fails the typecheck in filtersToListProductsArgs.
export const PRODUCT_OVERRIDE_MISSING = ['cost', 'desi'] as const;
export type ProductOverrideMissing = (typeof PRODUCT_OVERRIDE_MISSING)[number];

/**
 * Products-specific FilterRow reviver on top of the generic shape guard: a
 * status row whose value is not a current status filter is dropped ENTIRELY
 * at URL ingestion. That covers hand-edited links (`value: "Archived"`) and
 * links saved before the status vocabulary changed (`value: "onSale"`).
 * Without this, such a row would render an applied-looking chip while
 * filterRowsToProductParams silently discards it, so the chip would lie
 * about the visible product set. ('status' mirrors PRODUCT_FILTER_FIELDS.status
 * in products-filter-fields.ts, inlined here to avoid an import cycle.)
 */
export function parseProductFilterRows(value: unknown): FilterRow[] {
  return parseFilterRows(value).filter((filterRow) => {
    if (filterRow.field !== 'status') return true;
    return typeof filterRow.value === 'string' && isProductStatusFilter(filterRow.value);
  });
}

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
  // Status / brand / category ride the advanced-filter FilterRow[] below —
  // the quick facet chips (and their brandId/categoryId/status URL params)
  // were retired in favor of the single `+ Filtre ekle` system.
  // Deep-link filter — empty string means "no productId filter active".
  // Set from feature pages (cost-profile detail → "Bağlı varyantlar") so
  // the seller lands on the products page with a single product visible.
  productId: parseAsString.withDefault(''),
  // Absent from URL -> null. Present and one of PRODUCT_OVERRIDE_MISSING ->
  // that value. Present but invalid (an old `vat` link included) -> null, the
  // nuqs default behavior. No .withDefault(): null is the "no override tab
  // active" signal, distinct from the implicit default for required fields.
  overrideMissing: parseAsStringEnum<ProductOverrideMissing>([...PRODUCT_OVERRIDE_MISSING]),
  // Advanced Filtering: the whole FilterRow[] rides one URL param as JSON.
  // parseProductFilterRows drops malformed entries AND enum-invalid status
  // rows so a stale/hostile URL degrades to "no filters".
  filters: parseAsJson<FilterRow[]>(parseProductFilterRows).withDefault([]),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(25),
  sort: parseAsStringEnum<ProductListSortExtended>([...PRODUCT_LIST_SORTS_EXTENDED]).withDefault(
    '-platformCreatedAt',
  ),
};

export interface ProductsFilters {
  q: string;
  productId: string;
  overrideMissing: ProductOverrideMissing | null;
  filters: FilterRow[];
  page: number;
  perPage: number;
  sort: ProductListSortExtended;
}
