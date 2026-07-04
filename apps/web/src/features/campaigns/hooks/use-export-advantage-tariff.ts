'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { exportAdvantageTariff } from '../api/export-advantage-tariff.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * Mutation hook for exporting an Advantage tariff's patched Trendyol `.xlsx`. The
 * mutation variable is the `tariffId`; `mutateAsync` resolves with the file `Blob`
 * (the caller triggers the browser download). Export marks the tariff exported, so
 * onSuccess invalidates both the list (its "exported" column) and that tariff's
 * detail. No custom onError — the global pipeline toasts.
 */
export function useExportAdvantageTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<Blob, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<Blob, Error, string>({
    mutationFn: (tariffId) => exportAdvantageTariff(orgId, storeId, tariffId),
    onSuccess: (_blob, tariffId) => {
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.lists(orgId, storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
