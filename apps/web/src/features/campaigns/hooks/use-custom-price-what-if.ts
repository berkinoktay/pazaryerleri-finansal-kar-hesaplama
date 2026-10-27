'use client';

import type { EstimateCampaignItemResult } from '../api/estimate-campaign-item.api';
import type { MarketplaceCampaignRow } from '../lib/adapt-marketplace-campaign';
import { customPriceStatus } from '../lib/marketplace-campaign-selection';
import { useTariffScope } from '../lib/tariff-scope';
import { useCustomPriceEstimate } from './use-custom-price-estimate';
import { useDebouncedValue } from './use-debounced-value';

const DEBOUNCE_MS = 400;

export interface CustomPriceWhatIf {
  /** The estimate for exactly the buffered price; null while none has landed for it. */
  result: EstimateCampaignItemResult | null;
  /** The latest request for it failed — show the plain badge, never a stuck skeleton. */
  isError: boolean;
  /** A request is in flight. */
  isFetching: boolean;
}

/**
 * The what-if behind a row's buffered custom price, shared by BOTH price cards (the custom card
 * shows it, the maximum card races it for the "En kârlı" ribbon) in both layouts. A NEW valid
 * price is priced ~400ms after the seller stops typing; the saved price needs no request — its
 * figures already ride on the row — unless `immediate` asks for it (an open breakdown). Every
 * caller derives the same query key, so however many cards subscribe, one request goes out.
 */
export function useCustomPriceWhatIf(
  row: MarketplaceCampaignRow,
  price: string | null,
  immediate = false,
): CustomPriceWhatIf {
  const scope = useTariffScope();
  const valid = customPriceStatus(price, row) === 'valid';
  const isSavedPrice = price !== null && price === row.customPrice;
  const settledPrice = useDebouncedValue(valid && !isSavedPrice ? price : null, DEBOUNCE_MS);
  const requestPrice = immediate && valid ? price : settledPrice;
  const estimate = useCustomPriceEstimate(
    scope.orgId,
    scope.storeId,
    scope.tariffId,
    row.id,
    requestPrice,
  );

  return {
    result:
      estimate.data !== undefined && requestPrice !== null && requestPrice === price
        ? estimate.data
        : null,
    isError: estimate.isError,
    isFetching: estimate.isFetching,
  };
}
