'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  importFlashProducts,
  type ImportFlashProductsResponse,
} from '../api/import-flash-products.api';
import { flashProductKeys } from '../query-keys';

export interface ImportFlashProductsVars {
  file: File;
  name?: string;
}

/**
 * Mutation hook for uploading a Flash Products Excel. On success invalidates the store's
 * Flash Products list so the new upload appears. No custom onError — the global
 * QueryProvider pipeline toasts; the upload form surfaces VALIDATION_ERROR field issues
 * inline.
 */
export function useImportFlashProducts(
  orgId: string,
  storeId: string,
): UseMutationResult<ImportFlashProductsResponse, Error, ImportFlashProductsVars> {
  const queryClient = useQueryClient();
  return useMutation<ImportFlashProductsResponse, Error, ImportFlashProductsVars>({
    mutationFn: ({ file, name }) => importFlashProducts(orgId, storeId, file, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: flashProductKeys.lists(orgId, storeId),
      });
    },
  });
}
