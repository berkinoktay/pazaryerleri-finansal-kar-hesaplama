'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { exportFlashProducts, type TariffExportFile } from '../api/export-flash-products.api';
import { flashProductKeys } from '../query-keys';

/**
 * Mutation hook for exporting a Flash Products list's patched Trendyol `.xlsx`. The
 * mutation variable is the `listId`; the result carries the file bytes + the server-chosen
 * filename — the caller triggers the browser download. Export marks the list exported, so
 * onSuccess invalidates both the list (its "exported" column) and that list's detail. No
 * custom onError — the global pipeline toasts.
 */
export function useExportFlashProducts(
  orgId: string,
  storeId: string,
): UseMutationResult<TariffExportFile, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<TariffExportFile, Error, string>({
    mutationFn: (listId) => exportFlashProducts(orgId, storeId, listId),
    onSuccess: (_file, listId) => {
      void queryClient.invalidateQueries({
        queryKey: flashProductKeys.lists(orgId, storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: flashProductKeys.detail(orgId, storeId, listId),
      });
    },
  });
}
