'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateSelections,
  type UpdateSelectionsBody,
  type UpdateSelectionsResponse,
} from '../api/update-selections.api';
import { commissionTariffKeys } from '../query-keys';

/**
 * Mutation hook for saving band selections + custom prices on a tariff. On
 * success invalidates that tariff's detail so the persisted selection reflects.
 * No custom onError — the global pipeline toasts.
 */
export function useUpdateSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<UpdateSelectionsResponse, Error, UpdateSelectionsBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateSelectionsResponse, Error, UpdateSelectionsBody>({
    mutationFn: (body) => updateSelections(orgId, storeId, tariffId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: commissionTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
