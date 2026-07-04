'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  listAdvantageTariffs,
  type AdvantageTariffListItem,
} from '../api/list-advantage-tariffs.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * useQuery wrapper for the saved Advantage-tariff list. Pass `storeId = null` to
 * disable (no store context). `placeholderData` keeps the previous rows on screen
 * while a refetch (e.g. after import/delete) is in flight.
 */
export function useAdvantageTariffList(
  orgId: string,
  storeId: string | null,
): UseQueryResult<AdvantageTariffListItem[]> {
  return useQuery<AdvantageTariffListItem[]>({
    queryKey:
      storeId !== null
        ? advantageTariffKeys.lists(orgId, storeId)
        : ([...advantageTariffKeys.all, 'list', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null) throw new Error('useAdvantageTariffList called with null storeId');
      return listAdvantageTariffs(orgId, storeId);
    },
    enabled: storeId !== null,
    placeholderData: (previous) => previous,
  });
}
