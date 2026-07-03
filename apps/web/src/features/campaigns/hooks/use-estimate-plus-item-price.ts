'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  estimatePlusItemPrice,
  type EstimatePlusPriceBody,
  type EstimatePlusPriceResult,
} from '../api/estimate-plus-item-price.api';

export interface EstimatePlusItemPriceVars {
  itemId: string;
  body: EstimatePlusPriceBody;
}

/**
 * Mutation hook for the on-demand Plus profit estimate (breakdown modal +
 * custom-price what-if). No cache invalidation — estimate is a pure compute with no
 * persistent side effect.
 *
 * `calculable:false` is a normal 200, NOT an error — check `result.calculable`
 * before reading `result.breakdown`. Real errors flow through the global onError
 * pipeline, so no custom onError here. For the debounced custom-price input, drive
 * it from `mutateAsync` in a debounced effect at the call site.
 */
export function useEstimatePlusItemPrice(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<EstimatePlusPriceResult, Error, EstimatePlusItemPriceVars> {
  return useMutation<EstimatePlusPriceResult, Error, EstimatePlusItemPriceVars>({
    mutationFn: ({ itemId, body }) => estimatePlusItemPrice(orgId, storeId, tariffId, itemId, body),
  });
}
