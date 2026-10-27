'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getMarketplaceCampaignDetail,
  type MarketplaceCampaignDetail,
} from '../api/get-marketplace-campaign-detail.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * useQuery wrapper for one marketplace campaign's detail (items + per-scenario profit).
 * Disabled until both `storeId` and `campaignId` are known (no store / no route param).
 * Returns the raw `MarketplaceCampaignDetail` — call `adaptMarketplaceCampaignDetail` (see
 * `../lib/adapt-marketplace-campaign`) in the consuming component to get the table-ready
 * `{ header, rows }` shape, mirroring how `useDiscountListDetail` + `toDiscountListView` split
 * fetch from projection.
 */
export function useMarketplaceCampaignDetail(
  orgId: string,
  storeId: string | null,
  campaignId: string | null,
): UseQueryResult<MarketplaceCampaignDetail> {
  const enabled = storeId !== null && campaignId !== null;
  return useQuery<MarketplaceCampaignDetail>({
    queryKey: enabled
      ? marketplaceCampaignKeys.detail(orgId, storeId, campaignId)
      : ([...marketplaceCampaignKeys.all, 'detail', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null || campaignId === null) {
        throw new Error('useMarketplaceCampaignDetail called with null args');
      }
      return getMarketplaceCampaignDetail(orgId, storeId, campaignId);
    },
    enabled,
  });
}
