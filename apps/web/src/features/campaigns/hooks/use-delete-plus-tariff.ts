'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { deletePlusTariff } from '../api/delete-plus-tariff.api';
import { plusCommissionTariffKeys } from '../query-keys';

/**
 * Mutation hook for deleting a Plus tariff. The mutation variable is the
 * `tariffId`. On success invalidates the store's Plus-tariff list. No custom
 * onError — the global pipeline toasts.
 */
export function useDeletePlusTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (tariffId) => deletePlusTariff(orgId, storeId, tariffId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: plusCommissionTariffKeys.lists(orgId, storeId),
      });
    },
  });
}
