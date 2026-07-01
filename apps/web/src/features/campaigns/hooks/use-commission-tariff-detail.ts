'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getTariffDetail, type CommissionTariffDetail } from '../api/get-tariff-detail.api';
import { commissionTariffKeys } from '../query-keys';

/**
 * useQuery wrapper for one tariff's detail (periods + per-band profit). Disabled
 * until both `storeId` and `tariffId` are known (no store / no route param).
 */
export function useCommissionTariffDetail(
  orgId: string,
  storeId: string | null,
  tariffId: string | null,
): UseQueryResult<CommissionTariffDetail> {
  const enabled = storeId !== null && tariffId !== null;
  return useQuery<CommissionTariffDetail>({
    queryKey: enabled
      ? commissionTariffKeys.detail(orgId, storeId, tariffId)
      : ([...commissionTariffKeys.all, 'detail', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null || tariffId === null) {
        throw new Error('useCommissionTariffDetail called with null args');
      }
      return getTariffDetail(orgId, storeId, tariffId);
    },
    enabled,
  });
}
