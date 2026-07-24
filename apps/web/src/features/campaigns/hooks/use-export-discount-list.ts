'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { exportDiscountList, type TariffExportFile } from '../api/export-discount-list.api';
import { discountListKeys } from '../query-keys';

/**
 * Mutation hook for exporting a discount list's patched Trendyol `.xlsx`. The mutation variable
 * is the `listId`; the result carries the file bytes + the server-chosen filename — the caller
 * triggers the browser download. Export marks the list exported, so onSuccess invalidates both
 * the list (its "exported" column) and that list's detail. No custom onError — the global
 * pipeline toasts.
 */
export function useExportDiscountList(
  orgId: string,
  storeId: string,
): UseMutationResult<TariffExportFile, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<TariffExportFile, Error, string>({
    mutationFn: (listId) => exportDiscountList(orgId, storeId, listId),
    onSuccess: (_file, listId) => {
      void queryClient.invalidateQueries({
        queryKey: discountListKeys.lists(orgId, storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: discountListKeys.detail(orgId, storeId, listId),
      });
    },
  });
}
