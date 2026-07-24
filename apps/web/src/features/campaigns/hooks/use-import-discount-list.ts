'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  importDiscountList,
  type DiscountConfigFormValues,
  type ImportDiscountListResponse,
} from '../api/import-discount-list.api';
import { discountListKeys } from '../query-keys';

export interface ImportDiscountListVars {
  file: File;
  name?: string;
  config: DiscountConfigFormValues;
}

/**
 * Mutation hook for uploading a discount-list Excel + its discount configuration. On success
 * invalidates the store's discount lists so the new upload appears. No custom onError — the
 * global QueryProvider pipeline toasts; the upload form surfaces VALIDATION_ERROR field issues
 * inline.
 */
export function useImportDiscountList(
  orgId: string,
  storeId: string,
): UseMutationResult<ImportDiscountListResponse, Error, ImportDiscountListVars> {
  const queryClient = useQueryClient();
  return useMutation<ImportDiscountListResponse, Error, ImportDiscountListVars>({
    mutationFn: ({ file, name, config }) =>
      importDiscountList(orgId, storeId, { file, name, config }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: discountListKeys.lists(orgId, storeId),
      });
    },
  });
}
