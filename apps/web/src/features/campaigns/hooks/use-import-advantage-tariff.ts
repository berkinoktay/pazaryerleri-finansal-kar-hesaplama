'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  importAdvantageTariff,
  type ImportAdvantageTariffResponse,
} from '../api/import-advantage-tariff.api';
import { advantageTariffKeys } from '../query-keys';

export interface ImportAdvantageTariffVars {
  file: File;
  name?: string;
  /** Commission tariff (week) whose reduced rates this Advantage upload reads; omit for category commission. */
  commissionSourceTariffId?: string;
}

/**
 * Mutation hook for uploading an Advantage product-label Excel. On success
 * invalidates the store's Advantage-tariff list so the new upload appears. No custom
 * onError — the global QueryProvider pipeline toasts; the upload form surfaces
 * VALIDATION_ERROR field issues inline.
 */
export function useImportAdvantageTariff(
  orgId: string,
  storeId: string,
): UseMutationResult<ImportAdvantageTariffResponse, Error, ImportAdvantageTariffVars> {
  const queryClient = useQueryClient();
  return useMutation<ImportAdvantageTariffResponse, Error, ImportAdvantageTariffVars>({
    mutationFn: ({ file, name, commissionSourceTariffId }) =>
      importAdvantageTariff(orgId, storeId, file, name, commissionSourceTariffId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.lists(orgId, storeId),
      });
    },
  });
}
