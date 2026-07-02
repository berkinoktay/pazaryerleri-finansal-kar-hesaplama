'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { importPlusTariff, type ImportPlusTariffResponse } from '../api/import-plus-tariff.api';
import { plusCommissionTariffKeys } from '../query-keys';

export interface ImportPlusTariffVars {
  file: File;
  name?: string;
}

/**
 * Mutation hook for uploading a Plus commission-tariff Excel. On success
 * invalidates the store's Plus-tariff list so the new upload appears. No custom
 * onError — the global QueryProvider pipeline toasts; the upload form surfaces
 * VALIDATION_ERROR field issues inline.
 */
export function useImportPlusTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<ImportPlusTariffResponse, Error, ImportPlusTariffVars> {
  const queryClient = useQueryClient();
  return useMutation<ImportPlusTariffResponse, Error, ImportPlusTariffVars>({
    mutationFn: ({ file, name }) => importPlusTariff(orgId, storeId, file, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: plusCommissionTariffKeys.lists(orgId, storeId),
      });
    },
  });
}
