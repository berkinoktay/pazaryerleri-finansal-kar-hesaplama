'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  estimateCampaignItem,
  type EstimateCampaignItemBody,
  type EstimateCampaignItemResult,
} from '../api/estimate-campaign-item.api';

export interface EstimateCampaignItemVars {
  itemId: string;
  body: EstimateCampaignItemBody;
}

/**
 * Mutation hook for the on-demand campaign profit breakdown (breakdown modal, current / max /
 * custom scenario). No cache invalidation — estimate is a pure compute with no persistent
 * side effect.
 *
 * `calculable:false` is a normal 200, NOT an error — check `result.calculable` before reading
 * `result.breakdown`. Real errors (e.g. a custom price above the item maximum) flow through
 * the global onError pipeline, so no custom onError here.
 */
export function useEstimateCampaignItem(
  orgId: string,
  storeId: string,
  campaignId: string,
): UseMutationResult<EstimateCampaignItemResult, Error, EstimateCampaignItemVars> {
  return useMutation<EstimateCampaignItemResult, Error, EstimateCampaignItemVars>({
    mutationFn: ({ itemId, body }) =>
      estimateCampaignItem(orgId, storeId, campaignId, itemId, body),
  });
}
