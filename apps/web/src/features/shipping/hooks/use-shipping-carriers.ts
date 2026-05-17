'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listShippingCarriers } from '../api/list-shipping-carriers.api';
import type { ShippingCarrier } from '../types/shipping.types';

/**
 * Query key factory for the shipping feature.
 *
 * `all` is the prefix every key shares so blanket invalidation
 * (e.g. when the active org switches) can target the whole feature
 * with a single call. `carriers` is keyed by org + platform; `config`
 * and `ownTariff` are keyed by storeId because all callers already
 * know the store. Keeping the keys here (rather than in their own
 * `query-keys.ts`) mirrors the lean structure of features/sync — for
 * a 3-hook feature, a separate keys file is overkill.
 */
export const shippingKeys = {
  all: ['shipping'] as const,
  carriers: (orgId: string, platform?: string) =>
    [...shippingKeys.all, 'carriers', orgId, platform] as const,
  config: (storeId: string) => [...shippingKeys.all, 'config', storeId] as const,
  ownTariff: (storeId: string) => [...shippingKeys.all, 'own-tariff', storeId] as const,
};

/**
 * Lists the marketplace's carrier catalogue (10 carriers for Trendyol).
 * Pass `null` for `orgId` to disable the query (used while the active
 * org is still resolving server-side).
 */
export function useShippingCarriers(
  orgId: string | null,
  platform?: 'TRENDYOL' | 'HEPSIBURADA',
): UseQueryResult<ShippingCarrier[]> {
  return useQuery<ShippingCarrier[]>({
    queryKey: shippingKeys.carriers(orgId ?? '', platform),
    queryFn: () => listShippingCarriers(orgId as string, platform),
    enabled: typeof orgId === 'string' && orgId.length > 0,
  });
}
