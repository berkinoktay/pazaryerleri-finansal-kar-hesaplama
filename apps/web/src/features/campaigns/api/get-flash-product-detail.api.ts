import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type FlashProductDetail = components['schemas']['FlashProductDetail'];
export type FlashProductDetailItem = components['schemas']['FlashProductDetailItem'];
export type FlashOffer = components['schemas']['FlashOffer'];
export type FlashCommissionBand = components['schemas']['FlashCommissionBand'];
export type FlashCommissionSource = components['schemas']['FlashCommissionSource'];
export type FlashOfferType = components['schemas']['FlashOfferType'];
export type FlashValidity = components['schemas']['FlashValidity'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}
 *
 * Returns one Flash Products list with its offer rows (NO periods — instead each row is
 * one product × one date). Each row carries the `current` price scenario (flat fields)
 * plus up to two dated flash offers: `offer24` (24 Saatlik) and `offer3` (3 Saatlik),
 * each with its window (`startsAt`/`endsAt`/`validity`), reduced commission, and the net
 * profit + margin COMPUTED on read by the backend engine. Each offer's reduced commission
 * is AUTO-resolved from the store's commission tariff (the offer's window resolves into a
 * band) or falls back to the flat "Mevcut Komisyon" rate — surfaced per row via
 * `commissionSource` ('band' | 'current') and `commissionBands` (the ladder for the ⓘ
 * popover, null on the flat fallback). The same product appears on several rows (different
 * dates). Money fields are GROSS decimal strings — the frontend renders, never computes.
 * Uncalculable rows carry null profit/margin.
 */
export async function getFlashProductDetail(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<FlashProductDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}',
    { params: { path: { orgId, storeId, listId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
