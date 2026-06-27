'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { updateProfitSettings } from '../api/update-profit-settings.api';
import type { ProfitSettings, UpdateProfitSettingsInput } from '../types/profit-settings.types';

import { profitSettingsKeys } from './use-store-profit-settings';

/**
 * Mutation hook for changing a store's profit-formula settings.
 *
 * Invalidation: ONLY profitSettingsKeys.config(storeId) — the form's own source
 * of truth. Deliberately NO ['orders'] / ['products'] invalidation: the change is
 * snapshot-at-create and forward-only, so it affects only orders CREATED AFTER it.
 * Existing orders keep their stored profit values, and every list/aggregate reads
 * those stored values — nothing downstream goes stale. (Contrast use-update-shipping-config,
 * which DOES invalidate ['products'] because shipping changes recompute existing rows.)
 */
export function useUpdateStoreProfitSettings(
  orgId: string,
  storeId: string,
): UseMutationResult<ProfitSettings, Error, UpdateProfitSettingsInput> {
  const queryClient = useQueryClient();

  return useMutation<ProfitSettings, Error, UpdateProfitSettingsInput>({
    mutationFn: (body) => updateProfitSettings(orgId, storeId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profitSettingsKeys.config(storeId) });
    },
  });
}
