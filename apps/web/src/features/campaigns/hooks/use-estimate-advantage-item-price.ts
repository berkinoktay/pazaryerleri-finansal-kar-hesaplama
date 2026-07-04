'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  estimateAdvantageItemPrice,
  type EstimateAdvantagePriceBody,
  type EstimateAdvantagePriceResult,
} from '../api/estimate-advantage-item-price.api';

export interface EstimateAdvantageItemPriceVars {
  itemId: string;
  body: EstimateAdvantagePriceBody;
}

/**
 * Mutation hook for the on-demand Advantage profit estimate (breakdown modal +
 * custom-price what-if). No cache invalidation — estimate is a pure compute with no
 * persistent side effect.
 *
 * `calculable:false` is a normal 200, NOT an error — check `result.calculable` before
 * reading `result.breakdown`. Real errors flow through the global onError pipeline, so
 * no custom onError here. For the debounced custom-price input, drive it from
 * `mutateAsync` in a debounced effect at the call site.
 */
export function useEstimateAdvantageItemPrice(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<EstimateAdvantagePriceResult, Error, EstimateAdvantageItemPriceVars> {
  return useMutation<EstimateAdvantagePriceResult, Error, EstimateAdvantageItemPriceVars>({
    mutationFn: ({ itemId, body }) =>
      estimateAdvantageItemPrice(orgId, storeId, tariffId, itemId, body),
  });
}
