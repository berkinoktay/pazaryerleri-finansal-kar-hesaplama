'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listPricingFacets, type PricingFacetsResponse } from '../api/list-pricing-facets.api';
import { productPricingKeys } from '../query-keys';

const FACETS_STALE_TIME_MS = 5 * 60 * 1000; // facets change rarely; cache for 5 min

/**
 * Brand + category facet lists for the pricing filter toolbar. Pass `null`
 * for either id to disable (no store / no org context).
 */
export function usePricingFacets(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<PricingFacetsResponse> {
  return useQuery<PricingFacetsResponse>({
    queryKey:
      orgId !== null && storeId !== null
        ? productPricingKeys.facets(orgId, storeId)
        : (['product-pricing', 'facets', '__disabled__'] as const),
    queryFn: () => {
      if (orgId === null || storeId === null) {
        throw new Error('usePricingFacets called with null args');
      }
      return listPricingFacets(orgId, storeId);
    },
    enabled: orgId !== null && storeId !== null,
    staleTime: FACETS_STALE_TIME_MS,
  });
}
