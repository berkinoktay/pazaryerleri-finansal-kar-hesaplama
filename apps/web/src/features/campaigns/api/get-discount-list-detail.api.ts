import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type DiscountListDetail = components['schemas']['DiscountListDetail'];
export type DiscountListDetailItem = components['schemas']['DiscountListDetailItem'];
export type DiscountListSummary = components['schemas']['DiscountListSummary'];
export type DiscountType = components['schemas']['DiscountType'];
export type DiscountValueKind = components['schemas']['DiscountValueKind'];
export type DiscountCommissionSource = components['schemas']['DiscountCommissionSource'];
export type DiscountCommissionBand = components['schemas']['DiscountCommissionBand'];
export type DiscountItemReason = components['schemas']['DiscountItemReason'];

/**
 * GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}
 *
 * Returns one discount list with its configuration, a summary card (item / selected counts,
 * per-order discount cost, max total cost, average profit delta) and every item carrying the
 * `current` and `discounted` price SCENARIOS. Each scenario carries its price, reduced
 * commission (with `commissionSource`), and the net profit + margin COMPUTED on read by the
 * profit engine — the reduced commission is RE-resolved on the scenario price (a lower price
 * can land in a different commission band). Money fields are GROSS decimal strings — the
 * frontend renders, never computes. Uncalculable rows carry null profit/margin and a `reason`.
 */
export async function getDiscountListDetail(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<DiscountListDetail> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}',
    { params: { path: { orgId, storeId, listId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
