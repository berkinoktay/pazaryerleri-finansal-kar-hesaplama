'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { deleteMarketplaceCampaign } from '../api/delete-marketplace-campaign.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * Mutation hook for deleting a marketplace campaign. The mutation variable is the
 * `campaignId`. On success invalidates the store's campaigns. No custom onError — the global
 * pipeline toasts.
 */
export function useDeleteMarketplaceCampaign(
  orgId: string,
  storeId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (campaignId) => deleteMarketplaceCampaign(orgId, storeId, campaignId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: marketplaceCampaignKeys.lists(orgId, storeId),
      });
    },
  });
}
