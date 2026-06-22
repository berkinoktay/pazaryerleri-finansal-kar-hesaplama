'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  listProductPricing,
  type ListProductPricingArgs,
  type ListProductPricingResponse,
} from '../api/list-product-pricing.api';
import { productPricingKeys, type ProductPricingListFilters } from '../query-keys';

/**
 * useQuery wrapper for the product-pricing list. `page` / `perPage` /
 * `sortBy` are part of the queryKey so changing them re-fires the query
 * (TanStack Query caches each page slot independently — cheap on paging
 * back and forth).
 *
 * Pass `null` to disable (no store / no org context).
 */
export function useProductPricingList(
  args: ListProductPricingArgs | null,
): UseQueryResult<ListProductPricingResponse> {
  return useQuery<ListProductPricingResponse>({
    queryKey:
      args !== null
        ? productPricingKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : (['product-pricing', 'list', '__disabled__'] as const),
    queryFn: () => {
      if (args === null) throw new Error('useProductPricingList called with null args');
      return listProductPricing(args);
    },
    enabled: args !== null,
    placeholderData: (previous) => previous,
  });
}

function argsToFilters(args: ListProductPricingArgs): ProductPricingListFilters {
  return {
    sortBy: args.sortBy,
    q: args.q ?? '',
    profitStatus: args.profitStatus ?? 'all',
    marginMin: args.marginMin ?? '',
    marginMax: args.marginMax ?? '',
    categoryId: args.categoryId ?? '',
    brandId: args.brandId ?? '',
    page: args.page,
    perPage: args.perPage,
  };
}
