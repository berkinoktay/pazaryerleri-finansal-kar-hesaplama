'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  estimateFlashItemPrice,
  type EstimateFlashPriceBody,
  type EstimateFlashPriceResult,
} from '../api/estimate-flash-item-price.api';

export interface EstimateFlashItemPriceVars {
  itemId: string;
  body: EstimateFlashPriceBody;
}

/**
 * Mutation hook for the on-demand Flash profit estimate (breakdown modal + custom-price
 * what-if). No cache invalidation — estimate is a pure compute with no persistent side
 * effect.
 *
 * `calculable:false` is a normal 200, NOT an error — check `result.calculable` before
 * reading `result.breakdown`. Real errors flow through the global onError pipeline, so no
 * custom onError here. For the debounced custom-price input, drive it from a debounced
 * effect at the call site.
 */
export function useEstimateFlashItemPrice(
  orgId: string,
  storeId: string,
  listId: string,
): UseMutationResult<EstimateFlashPriceResult, Error, EstimateFlashItemPriceVars> {
  return useMutation<EstimateFlashPriceResult, Error, EstimateFlashItemPriceVars>({
    mutationFn: ({ itemId, body }) => estimateFlashItemPrice(orgId, storeId, listId, itemId, body),
  });
}
