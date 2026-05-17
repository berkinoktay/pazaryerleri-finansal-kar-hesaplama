'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getCarrierTariffs } from '../api/get-carrier-tariffs.api';
import type { CarrierTariffs } from '../types/shipping.types';

import { shippingKeys } from './use-shipping-carriers';

/**
 * Extends the shared `shippingKeys` factory with the per-carrier tariff
 * lookup. Keyed by `(orgId, carrierId)` so switching either invalidates
 * cleanly; co-located with the other keys in `use-shipping-carriers.ts`
 * via the factory's `all` prefix.
 */
function tariffsKey(orgId: string, carrierId: string): readonly unknown[] {
  return [...shippingKeys.all, 'carrier-tariffs', orgId, carrierId] as const;
}

/**
 * Fetches the desi-bazlı tariff + (optional) Barem desteği tier table
 * for a single carrier. Returns the inert/disabled query when
 * `carrierId` is null — the call site (settings panel) renders the
 * table only when a carrier is selected, so there is no reason to
 * spend the round-trip otherwise.
 */
export function useCarrierTariffs(
  orgId: string | null,
  carrierId: string | null,
): UseQueryResult<CarrierTariffs> {
  return useQuery<CarrierTariffs>({
    queryKey: tariffsKey(orgId ?? '', carrierId ?? ''),
    queryFn: () => getCarrierTariffs(orgId as string, carrierId as string),
    enabled:
      typeof orgId === 'string' &&
      orgId.length > 0 &&
      typeof carrierId === 'string' &&
      carrierId.length > 0,
  });
}
