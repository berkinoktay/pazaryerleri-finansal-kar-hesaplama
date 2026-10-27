'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  importMarketplaceCampaign,
  type ImportMarketplaceCampaignInput,
  type ImportMarketplaceCampaignResponse,
} from '../api/import-marketplace-campaign.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * Mutation hook for uploading a marketplace-campaign Excel + its campaign configuration. On
 * success invalidates the store's campaigns so the new upload appears. No custom onError — the
 * global QueryProvider pipeline toasts; the upload form surfaces VALIDATION_ERROR field issues
 * inline.
 */
export function useImportMarketplaceCampaign(
  orgId: string,
  storeId: string,
): UseMutationResult<ImportMarketplaceCampaignResponse, Error, ImportMarketplaceCampaignInput> {
  const queryClient = useQueryClient();
  return useMutation<ImportMarketplaceCampaignResponse, Error, ImportMarketplaceCampaignInput>({
    mutationFn: (input) => importMarketplaceCampaign(orgId, storeId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: marketplaceCampaignKeys.lists(orgId, storeId),
      });
    },
  });
}
