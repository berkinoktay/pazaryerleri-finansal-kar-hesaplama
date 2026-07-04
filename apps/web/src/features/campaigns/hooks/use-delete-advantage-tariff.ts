'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { deleteAdvantageTariff } from '../api/delete-advantage-tariff.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * Mutation hook for deleting an Advantage tariff. The mutation variable is the
 * `tariffId`. On success invalidates the store's Advantage-tariff list. No custom
 * onError — the global pipeline toasts.
 */
export function useDeleteAdvantageTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (tariffId) => deleteAdvantageTariff(orgId, storeId, tariffId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.lists(orgId, storeId),
      });
    },
  });
}
