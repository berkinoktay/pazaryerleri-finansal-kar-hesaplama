'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  estimateCampaignItem,
  type EstimateCampaignItemResult,
} from '../api/estimate-campaign-item.api';
import { marketplaceCampaignKeys } from '../query-keys';

/**
 * useQuery wrapper for a custom campaign price's what-if estimate. Keyed by item + price under the
 * campaign's detail key, so every card that shows the same row's price shares ONE request and its
 * cache (the desktop table and the mobile cards are mounted together), and any write that
 * invalidates the detail — a config edit, a selections save — re-prices the what-ifs too.
 * Disabled while `price` is null.
 */
export function useCustomPriceEstimate(
  orgId: string,
  storeId: string,
  campaignId: string,
  itemId: string,
  price: string | null,
): UseQueryResult<EstimateCampaignItemResult> {
  return useQuery<EstimateCampaignItemResult>({
    queryKey: marketplaceCampaignKeys.customEstimate(
      orgId,
      storeId,
      campaignId,
      itemId,
      price ?? '',
    ),
    queryFn: () => {
      if (price === null) throw new Error('useCustomPriceEstimate called without a price');
      return estimateCampaignItem(orgId, storeId, campaignId, itemId, {
        scenario: 'custom',
        customPrice: price,
      });
    },
    enabled: price !== null,
    // The answer for one price does not age; only a write that invalidates the detail
    // re-prices it. Without this, a card whose debounce settles after another card's request
    // returned would see stale data and send a second request.
    staleTime: Infinity,
  });
}
