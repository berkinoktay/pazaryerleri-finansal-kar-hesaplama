'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  listProducts,
  type ListProductsArgs,
  type ListProductsResponse,
} from '../api/list-products.api';
import { productKeys, type ProductListFilters } from '../query-keys';

export function useProducts(args: ListProductsArgs | null): UseQueryResult<ListProductsResponse> {
  return useQuery<ListProductsResponse>({
    queryKey:
      args !== null
        ? productKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : ['products', 'list', '__disabled__'],
    queryFn: () => {
      if (args === null) throw new Error('useProducts called with null args');
      return listProducts(args);
    },
    enabled: args !== null,
  });
}

function argsToFilters(args: ListProductsArgs): ProductListFilters {
  return {
    q: args.q,
    status: args.status,
    brandId: args.brandId,
    categoryId: args.categoryId,
    page: args.page,
    perPage: args.perPage,
    sort: args.sort,
  };
}
