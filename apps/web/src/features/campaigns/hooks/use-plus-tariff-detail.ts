'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getPlusTariffDetail, type PlusTariffDetail } from '../api/get-plus-tariff-detail.api';
import { plusCommissionTariffKeys } from '../query-keys';

/**
 * useQuery wrapper for one Plus tariff's detail (product rows + per-scenario
 * profit). Disabled until both `storeId` and `tariffId` are known (no store / no
 * route param).
 */
export function usePlusTariffDetail(
  orgId: string,
  storeId: string | null,
  tariffId: string | null,
): UseQueryResult<PlusTariffDetail> {
  const enabled = storeId !== null && tariffId !== null;
  return useQuery<PlusTariffDetail>({
    queryKey: enabled
      ? plusCommissionTariffKeys.detail(orgId, storeId, tariffId)
      : ([...plusCommissionTariffKeys.all, 'detail', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null || tariffId === null) {
        throw new Error('usePlusTariffDetail called with null args');
      }
      return getPlusTariffDetail(orgId, storeId, tariffId);
    },
    enabled,
  });
}
