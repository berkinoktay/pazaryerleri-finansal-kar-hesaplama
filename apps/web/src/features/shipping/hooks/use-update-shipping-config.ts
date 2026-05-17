'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { updateShippingConfig } from '../api/update-shipping-config.api';
import type { ShippingConfig, UpdateShippingConfigInput } from '../types/shipping.types';

import { shippingKeys } from './use-shipping-carriers';

/**
 * Mutation hook for changing a store's shipping configuration.
 *
 * Invalidation matrix (spec §7.6):
 *   - shipping.config(storeId) — refresh the form's source of truth
 *   - ['products']            — the products list endpoint joins on
 *                               the carrier choice + computes the
 *                               estimated net profit per variant, so
 *                               flipping the carrier (or switching
 *                               to OWN_CONTRACT) materially changes
 *                               every row's shipping/estimate cells.
 *
 * The ['products'] invalidation uses the string literal rather than
 * importing productKeys from features/products — same convention as
 * use-update-cost-profile.ts (see its comment for the audit-boundaries
 * rationale).
 *
 * VALIDATION_ERROR (incl. SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT)
 * is silenced from the global toast pipeline at the provider level;
 * the form component renders the field-level inline message instead.
 */
export function useUpdateShippingConfig(
  orgId: string,
  storeId: string,
): UseMutationResult<ShippingConfig, Error, UpdateShippingConfigInput> {
  const queryClient = useQueryClient();

  return useMutation<ShippingConfig, Error, UpdateShippingConfigInput>({
    mutationFn: (body) => updateShippingConfig(orgId, storeId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shippingKeys.config(storeId) });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
