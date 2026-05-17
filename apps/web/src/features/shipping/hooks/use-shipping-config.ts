'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getShippingConfig } from '../api/get-shipping-config.api';
import type { ShippingConfig } from '../types/shipping.types';

import { shippingKeys } from './use-shipping-carriers';

/**
 * Fetches the active shipping config for a store. Pass `null` for
 * either id to disable the query (e.g. while the active store is
 * still resolving).
 */
export function useShippingConfig(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<ShippingConfig> {
  return useQuery<ShippingConfig>({
    queryKey: shippingKeys.config(storeId ?? ''),
    queryFn: () => getShippingConfig(orgId as string, storeId as string),
    enabled:
      typeof orgId === 'string' &&
      orgId.length > 0 &&
      typeof storeId === 'string' &&
      storeId.length > 0,
  });
}
