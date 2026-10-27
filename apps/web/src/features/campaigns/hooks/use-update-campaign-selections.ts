'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateCampaignSelections,
  type UpdateCampaignSelectionsBody,
  type UpdateCampaignSelectionsResponse,
} from '../api/update-campaign-selections.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * Mutation hook for saving per-item price choices on a marketplace campaign. On success
 * invalidates BOTH that campaign's detail (the persisted selection reflects) AND the store's
 * campaigns (the selected count changes). No custom onError — the global pipeline toasts.
 */
export function useUpdateCampaignSelections(
  orgId: string,
  storeId: string,
  campaignId: string,
): UseMutationResult<UpdateCampaignSelectionsResponse, Error, UpdateCampaignSelectionsBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateCampaignSelectionsResponse, Error, UpdateCampaignSelectionsBody>({
    mutationFn: (body) => updateCampaignSelections(orgId, storeId, campaignId, body),
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
