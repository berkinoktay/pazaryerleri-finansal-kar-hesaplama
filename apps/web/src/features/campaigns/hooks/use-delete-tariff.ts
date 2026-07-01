'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { deleteTariff } from '../api/delete-tariff.api';
import { commissionTariffKeys } from '../query-keys';

/**
 * Mutation hook for deleting a tariff. The mutation variable is the `tariffId`.
 * On success invalidates the store's tariff list. No custom onError — the global
 * pipeline toasts.
 */
export function useDeleteTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (tariffId) => deleteTariff(orgId, storeId, tariffId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commissionTariffKeys.lists(orgId, storeId) });
    },
  });
}
