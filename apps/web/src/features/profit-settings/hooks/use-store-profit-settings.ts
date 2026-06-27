'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getProfitSettings } from '../api/get-profit-settings.api';
import type { ProfitSettings } from '../types/profit-settings.types';

/**
 * Query key factory for the store profit-settings feature. Keyed by storeId —
 * every caller already knows the active store.
 */
export const profitSettingsKeys = {
  all: ['profit-settings'] as const,
  config: (storeId: string) => [...profitSettingsKeys.all, 'config', storeId] as const,
};

/**
 * Fetches the resolved profit-formula settings for a store. Pass `null` for
 * either id to disable the query (e.g. while the active store is still resolving).
 */
export function useStoreProfitSettings(
  orgId: string | null,
  storeId: string | null,
): UseQueryResult<ProfitSettings> {
  return useQuery<ProfitSettings>({
    queryKey: profitSettingsKeys.config(storeId ?? ''),
    queryFn: () => getProfitSettings(orgId as string, storeId as string),
    enabled:
      typeof orgId === 'string' &&
      orgId.length > 0 &&
      typeof storeId === 'string' &&
      storeId.length > 0,
  });
}
