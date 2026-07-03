'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { exportPlusTariff } from '../api/export-plus-tariff.api';
import { plusCommissionTariffKeys } from '../query-keys';

/**
 * Mutation hook for exporting a Plus tariff's patched Trendyol `.xlsx`. The
 * mutation variable is the `tariffId`; `mutateAsync` resolves with the file `Blob`
 * (the caller triggers the browser download). Export marks the tariff exported, so
 * onSuccess invalidates both the list (its "exported" column) and that tariff's
 * detail. No custom onError — the global pipeline toasts.
 */
export function useExportPlusTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<Blob, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<Blob, Error, string>({
    mutationFn: (tariffId) => exportPlusTariff(orgId, storeId, tariffId),
    onSuccess: (_blob, tariffId) => {
      void queryClient.invalidateQueries({
        queryKey: plusCommissionTariffKeys.lists(orgId, storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: plusCommissionTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
