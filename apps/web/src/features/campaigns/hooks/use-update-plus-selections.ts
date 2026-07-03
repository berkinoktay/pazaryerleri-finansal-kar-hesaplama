'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updatePlusSelections,
  type UpdatePlusSelectionsBody,
  type UpdatePlusSelectionsResponse,
} from '../api/update-plus-selections.api';
import { plusCommissionTariffKeys } from '../query-keys';

/**
 * Mutation hook for saving Plus opt-in choices + custom prices on a tariff. On
 * success invalidates that tariff's detail so the persisted selection reflects. No
 * custom onError — the global pipeline toasts.
 */
export function useUpdatePlusSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<UpdatePlusSelectionsResponse, Error, UpdatePlusSelectionsBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdatePlusSelectionsResponse, Error, UpdatePlusSelectionsBody>({
    mutationFn: (body) => updatePlusSelections(orgId, storeId, tariffId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: plusCommissionTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
