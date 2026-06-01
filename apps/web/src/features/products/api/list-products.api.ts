import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type ProductWithVariants = components['schemas']['ProductWithVariants'];
export type VariantSummary = components['schemas']['VariantSummary'];
export type ListProductsResponse = components['schemas']['ListProductsResponse'];

export interface ListProductsArgs {
  orgId: string;
  storeId: string;
  q?: string;
  status?: 'onSale' | 'archived' | 'locked' | 'blacklisted';
  brandId?: string;
  categoryId?: string;
  productId?: string;
  overrideMissing?: 'cost' | 'vat';
  // Advanced Filtering (PR-B2 backend / PR-F1 frontend). Multi-selects are
  // comma-separated strings (the wire format the backend csvParam expects).
  salePriceMin?: string;
  salePriceMax?: string;
  stockMin?: number;
  stockMax?: number;
  vatRateIn?: string;
  brandIdIn?: string;
  categoryIdIn?: string;
  page: number;
  perPage: number;
  sort:
    | '-platformCreatedAt'
    | 'platformCreatedAt'
    | '-platformModifiedAt'
    | 'platformModifiedAt'
    | 'title'
    | '-title'
    | 'salePrice'
    | '-salePrice'
    | 'totalStock'
    | '-totalStock';
}

export async function listProducts(args: ListProductsArgs): Promise<ListProductsResponse> {
  const { orgId, storeId, ...query } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/products',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ...(query.q !== undefined && query.q.length > 0 ? { q: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.brandId !== undefined && query.brandId.length > 0
            ? { brandId: query.brandId }
            : {}),
          ...(query.categoryId !== undefined && query.categoryId.length > 0
            ? { categoryId: query.categoryId }
            : {}),
          ...(query.productId !== undefined && query.productId.length > 0
            ? { productId: query.productId }
            : {}),
          ...(query.overrideMissing !== undefined
            ? { overrideMissing: query.overrideMissing }
            : {}),
          ...(query.salePriceMin !== undefined ? { salePriceMin: query.salePriceMin } : {}),
          ...(query.salePriceMax !== undefined ? { salePriceMax: query.salePriceMax } : {}),
          ...(query.stockMin !== undefined ? { stockMin: query.stockMin } : {}),
          ...(query.stockMax !== undefined ? { stockMax: query.stockMax } : {}),
          ...(query.vatRateIn !== undefined ? { vatRateIn: query.vatRateIn } : {}),
          ...(query.brandIdIn !== undefined ? { brandIdIn: query.brandIdIn } : {}),
          ...(query.categoryIdIn !== undefined ? { categoryIdIn: query.categoryIdIn } : {}),
          page: query.page,
          perPage: query.perPage,
          sort: query.sort,
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
