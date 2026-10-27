'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { keepPreviousWithinStore } from '@/lib/query-scope-placeholder';

import {
  listMarketplaceCampaigns,
  type MarketplaceCampaignListItem,
} from '../api/list-marketplace-campaigns.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * useQuery wrapper for the saved marketplace campaigns. Pass `storeId = null` to disable (no
 * store context). `placeholderData` keeps the previous rows on screen while a refetch (e.g.
 * after import/delete) is in flight, but drops them on a store switch.
 */
export function useMarketplaceCampaigns(
  orgId: string,
  storeId: string | null,
): UseQueryResult<MarketplaceCampaignListItem[]> {
  return useQuery<MarketplaceCampaignListItem[]>({
    queryKey:
      storeId !== null
        ? marketplaceCampaignKeys.lists(orgId, storeId)
        : ([...marketplaceCampaignKeys.all, 'list', '__disabled__'] as const),
    queryFn: () => {
      if (storeId === null) throw new Error('useMarketplaceCampaigns called with null storeId');
      return listMarketplaceCampaigns(orgId, storeId);
    },
    enabled: storeId !== null,
    // Drop the previous rows on a store switch so another store's list never
    // flashes on this store's screen; keep them for in-store refetches.
    placeholderData: keepPreviousWithinStore<MarketplaceCampaignListItem[]>(storeId ?? ''),
  });
}
