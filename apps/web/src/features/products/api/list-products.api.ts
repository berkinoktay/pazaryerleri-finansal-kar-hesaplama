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
  overrideMissing?: 'cost' | 'vat';
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
          ...(query.overrideMissing !== undefined
            ? { overrideMissing: query.overrideMissing }
            : {}),
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
