'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listProductFacets, type ProductFacetsResponse } from '../api/list-product-facets.api';
import { productKeys } from '../query-keys';

export function useProductFacets(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<ProductFacetsResponse> {
  return useQuery<ProductFacetsResponse>({
    queryKey:
      orgId !== null && storeId !== null
        ? productKeys.facets(orgId, storeId)
        : ['products', 'facets', '__disabled__'],
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('useProductFacets called with null args');
      }
      return listProductFacets(orgId, storeId);
    },
    enabled: orgId !== null && storeId !== null,
    staleTime: 5 * 60 * 1000, // facets change rarely; cache for 5 min
  });
}
