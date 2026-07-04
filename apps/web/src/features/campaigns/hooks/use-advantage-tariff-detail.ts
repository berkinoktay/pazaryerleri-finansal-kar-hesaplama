'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getAdvantageTariffDetail,
  type AdvantageTariffDetail,
} from '../api/get-advantage-tariff-detail.api';
import { advantageTariffKeys } from '../query-keys';

/**
 * useQuery wrapper for one Advantage tariff's detail (product rows + per-tier profit +
 * commission-source meta). Disabled until both `storeId` and `tariffId` are known (no
 * store / no route param).
 */
export function useAdvantageTariffDetail(
  orgId: string,
  storeId: string | null,
  tariffId: string | null,
): UseQueryResult<AdvantageTariffDetail> {
  const enabled = storeId !== null && tariffId !== null;
  return useQuery<AdvantageTariffDetail>({
    queryKey: enabled
      ? advantageTariffKeys.detail(orgId, storeId, tariffId)
      : ([...advantageTariffKeys.all, 'detail', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null || tariffId === null) {
        throw new Error('useAdvantageTariffDetail called with null args');
      }
      return getAdvantageTariffDetail(orgId, storeId, tariffId);
    },
    enabled,
  });
}
