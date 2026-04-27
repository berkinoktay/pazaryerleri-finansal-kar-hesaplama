import { parseAsInteger, parseAsString, parseAsStringEnum } from 'nuqs';

// Single source of truth for the URL ↔ React Query state binding on
// the products page. Mirrors the backend's ListProductsQuerySchema —
// when the backend gains a new filter, add the parser here and the
// rest of the page reacts automatically.

export const PRODUCT_VARIANT_STATUSES = ['onSale', 'archived', 'locked', 'blacklisted'] as const;
export type ProductVariantStatus = (typeof PRODUCT_VARIANT_STATUSES)[number];

export const PRODUCT_LIST_SORTS = [
  '-platformModifiedAt',
  'platformModifiedAt',
  'title',
  '-title',
] as const;
export type ProductListSort = (typeof PRODUCT_LIST_SORTS)[number];

export const PRODUCT_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export const productsFiltersParsers = {
  q: parseAsString.withDefault(''),
  status: parseAsStringEnum<ProductVariantStatus>([...PRODUCT_VARIANT_STATUSES]).withDefault(
    'onSale',
  ),
  brandId: parseAsString.withDefault(''),
  categoryId: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(25),
  sort: parseAsStringEnum<ProductListSort>([...PRODUCT_LIST_SORTS]).withDefault(
    '-platformModifiedAt',
  ),
};

export interface ProductsFilters {
  q: string;
  status: ProductVariantStatus;
  brandId: string;
  categoryId: string;
  page: number;
  perPage: number;
  sort: ProductListSort;
}
