'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  estimateDiscountItem,
  type EstimateDiscountItemBody,
  type EstimateDiscountItemResult,
} from '../api/estimate-discount-item.api';

export interface EstimateDiscountItemVars {
  itemId: string;
  body: EstimateDiscountItemBody;
}

/**
 * Mutation hook for the on-demand discount profit breakdown (breakdown modal, current vs.
 * discounted scenario). No cache invalidation — estimate is a pure compute with no persistent
 * side effect.
 *
 * `calculable:false` is a normal 200, NOT an error — check `result.calculable` before reading
 * `result.breakdown`. Real errors flow through the global onError pipeline, so no custom
 * onError here.
 */
export function useEstimateDiscountItem(
  orgId: string,
  storeId: string,
  listId: string,
): UseMutationResult<EstimateDiscountItemResult, Error, EstimateDiscountItemVars> {
  return useMutation<EstimateDiscountItemResult, Error, EstimateDiscountItemVars>({
    mutationFn: ({ itemId, body }) => estimateDiscountItem(orgId, storeId, listId, itemId, body),
  });
}
