'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  updateAdvantageCommissionSource,
  type UpdateAdvantageCommissionSourceBody,
  type UpdateAdvantageCommissionSourceResponse,
} from '../api/update-advantage-commission-source.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * Mutation hook for pinning (or clearing → auto) the commission tariff that supplies
 * an Advantage tariff's reduced rates. On success invalidates that tariff's detail so
 * every tier profit recomputes from the new source. No custom onError — the global
 * pipeline toasts.
 */
export function useUpdateAdvantageCommissionSource(
  orgId: string,
  storeId: string,
  tariffId: string,
): UseMutationResult<
  UpdateAdvantageCommissionSourceResponse,
  Error,
  UpdateAdvantageCommissionSourceBody
> {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateAdvantageCommissionSourceResponse,
    Error,
    UpdateAdvantageCommissionSourceBody
  >({
    mutationFn: (body) => updateAdvantageCommissionSource(orgId, storeId, tariffId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: advantageTariffKeys.detail(orgId, storeId, tariffId),
      });
    },
  });
}
