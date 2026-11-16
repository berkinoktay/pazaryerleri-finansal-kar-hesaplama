'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { importTariff, type ImportTariffResponse } from '../api/import-tariff.api';
import { commissionTariffKeys } from '../query-keys';

export interface ImportTariffVars {
  file: File;
  name?: string;
}

/**
 * Mutation hook for uploading a commission-tariff Excel. On success invalidates
 * the store's tariff list so the new upload appears. No custom onError — the
 * global QueryProvider pipeline toasts; the upload form surfaces VALIDATION_ERROR
 * field issues inline (WRONG_FILE_FOR_PAGE / EMPTY_FILE / NO_PERIOD…).
 */
export function useImportTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<ImportTariffResponse, Error, ImportTariffVars> {
  const queryClient = useQueryClient();
  return useMutation<ImportTariffResponse, Error, ImportTariffVars>({
    mutationFn: ({ file, name }) => importTariff(orgId, storeId, file, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commissionTariffKeys.lists(orgId, storeId) });
    },
  });
}
