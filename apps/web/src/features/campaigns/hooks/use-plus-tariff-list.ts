'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listPlusTariffs, type PlusTariffListItem } from '../api/list-plus-tariffs.api';
import { plusCommissionTariffKeys } from '../query-keys';

/**
 * useQuery wrapper for the saved Plus-tariff list. Pass `storeId = null` to disable
 * (no store context). `placeholderData` keeps the previous rows on screen while a
 * refetch (e.g. after import/delete) is in flight.
 */
export function usePlusTariffList(
  orgId: string,
  storeId: string | null,
): UseQueryResult<PlusTariffListItem[]> {
  return useQuery<PlusTariffListItem[]>({
    queryKey:
      storeId !== null
        ? plusCommissionTariffKeys.lists(orgId, storeId)
        : ([...plusCommissionTariffKeys.all, 'list', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null) throw new Error('usePlusTariffList called with null storeId');
      return listPlusTariffs(orgId, storeId);
    },
    enabled: storeId !== null,
    placeholderData: (previous) => previous,
  });
}
