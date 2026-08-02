'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  exportMarketplaceCampaign,
  type TariffExportFile,
} from '../api/export-marketplace-campaign.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * Mutation hook for exporting a marketplace campaign's patched Trendyol `.xlsx`. The mutation
 * variable is the `campaignId`; the result carries the file bytes + the server-chosen
 * filename — the caller triggers the browser download. Export marks the campaign exported, so
 * onSuccess invalidates both the list (its "exported" column) and that campaign's detail. No
 * custom onError — the global pipeline toasts.
 */
export function useExportMarketplaceCampaign(
  orgId: string,
  storeId: string,
): UseMutationResult<TariffExportFile, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<TariffExportFile, Error, string>({
    mutationFn: (campaignId) => exportMarketplaceCampaign(orgId, storeId, campaignId),
    onSuccess: (_file, campaignId) => {
      void queryClient.invalidateQueries({
        queryKey: marketplaceCampaignKeys.lists(orgId, storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: marketplaceCampaignKeys.detail(orgId, storeId, campaignId),
      });
    },
  });
}
