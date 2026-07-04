'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateAdvantageSelections,
  type UpdateAdvantageSelectionsBody,
  type UpdateAdvantageSelectionsResponse,
} from '../api/update-advantage-selections.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * Mutation hook for saving per-product tier choices + custom prices on an Advantage
 * tariff. On success invalidates that tariff's detail so the persisted selection
 * reflects. No custom onError — the global pipeline toasts.
 */
export function useUpdateAdvantageSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<UpdateAdvantageSelectionsResponse, Error, UpdateAdvantageSelectionsBody> {
  const queryClient = useQueryClient();
  return useMutation<UpdateAdvantageSelectionsResponse, Error, UpdateAdvantageSelectionsBody>({
    mutationFn: (body) => updateAdvantageSelections(orgId, storeId, tariffId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
