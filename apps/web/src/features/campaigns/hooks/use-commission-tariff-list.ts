'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { keepPreviousWithinStore } from '@/lib/query-scope-placeholder';

import { listTariffs, type CommissionTariffListItem } from '../api/list-tariffs.api';
import { commissionTariffKeys } from '../query-keys';

/**
 * useQuery wrapper for the saved commission-tariff list. Pass `storeId = null`
 * to disable (no store context). `placeholderData` keeps the previous rows on
 * screen while a refetch (e.g. after import/delete) is in flight.
 */
export function useCommissionTariffList(
  orgId: string,
  storeId: string | null,
): UseQueryResult<CommissionTariffListItem[]> {
  return useQuery<CommissionTariffListItem[]>({
    queryKey:
      storeId !== null
        ? commissionTariffKeys.lists(orgId, storeId)
        : ([...commissionTariffKeys.all, 'list', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null) throw new Error('useCommissionTariffList called with null storeId');
      return listTariffs(orgId, storeId);
    },
    enabled: storeId !== null,
    // Drop the previous rows on a store switch so another store's tariffs never
    // flash on this store's screen; keep them for in-store refetches.
    placeholderData: keepPreviousWithinStore<CommissionTariffListItem[]>(storeId ?? ''),
  });
}
