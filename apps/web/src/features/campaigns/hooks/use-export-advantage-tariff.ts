'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { exportAdvantageTariff, type TariffExportFile } from '../api/export-advantage-tariff.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * Mutation hook for exporting an Advantage tariff's patched Trendyol `.xlsx`. The mutation
 * variable is the `tariffId`; `mutateAsync` resolves with the file bytes + the server-chosen
 * filename — the caller triggers the browser download. Export marks the tariff exported, so
 * onSuccess invalidates both the list (its "exported" column) and that tariff's detail. No
 * custom onError — the global pipeline toasts.
 */
export function useExportAdvantageTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<TariffExportFile, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<TariffExportFile, Error, string>({
    mutationFn: (tariffId) => exportAdvantageTariff(orgId, storeId, tariffId),
    onSuccess: (_file, tariffId) => {
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.lists(orgId, storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
