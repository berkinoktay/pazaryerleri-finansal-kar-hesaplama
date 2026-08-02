'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateMarketplaceCampaign,
  type UpdateMarketplaceCampaignBody,
  type UpdateMarketplaceCampaignResponse,
} from '../api/update-marketplace-campaign.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * Mutation hook for updating a marketplace campaign's configuration (discount type +
 * parameters, Trendyol funding rate, window, name). On success invalidates BOTH that
 * campaign's detail (its scenarios are recomputed on read from the new config) AND the
 * store's campaigns (the list row shows the configuration). No custom onError — the global
 * pipeline toasts; the config form surfaces VALIDATION_ERROR field issues inline.
 */
export function useUpdateMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
): UseMutationResult<UpdateMarketplaceCampaignResponse, Error, UpdateMarketplaceCampaignBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateMarketplaceCampaignResponse, Error, UpdateMarketplaceCampaignBody>({
    mutationFn: (body) => updateMarketplaceCampaign(orgId, storeId, campaignId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: marketplaceCampaignKeys.detail(orgId, storeId, campaignId),
      });
      void queryClient.invalidateQueries({
        queryKey: marketplaceCampaignKeys.lists(orgId, storeId),
      });
    },
  });
}
