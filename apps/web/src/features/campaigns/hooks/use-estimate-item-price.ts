'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  estimateItemPrice,
  type EstimateItemPriceBody,
  type EstimateItemPriceResult,
} from '../api/estimate-item-price.api';

export interface EstimateItemPriceVars {
  itemId: string;
  body: EstimateItemPriceBody;
}

/**
 * Mutation hook for the on-demand profit estimate (band-click breakdown modal +
 * custom-price what-if). No cache invalidation — estimate is a pure compute with
 * no persistent side effect (mirrors `useQuoteProductPricing`).
 *
 * `calculable:false` is a normal 200, NOT an error — check `result.calculable`
 * before reading `result.breakdown`. Real errors flow through the global
 * onError pipeline, so no custom onError here. For the debounced custom-price
 * input, drive it from `mutateAsync` in a debounced effect at the call site.
 */
export function useEstimateItemPrice(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<EstimateItemPriceResult, Error, EstimateItemPriceVars> {
  return useMutation<EstimateItemPriceResult, Error, EstimateItemPriceVars>({
    mutationFn: ({ itemId, body }) => estimateItemPrice(orgId, storeId, tariffId, itemId, body),
  });
}
