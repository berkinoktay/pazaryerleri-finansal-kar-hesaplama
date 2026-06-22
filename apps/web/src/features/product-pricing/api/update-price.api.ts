import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdatePriceResponse = components['schemas']['UpdatePriceResponse'];

export interface UpdatePriceArgs {
  orgId: string;
  storeId: string;
  variantId: string;
  /** New GROSS (VAT-inclusive) sale price, decimal string. */
  salePrice: string;
}

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/product-pricing/price
 *
 * Writes a single variant's new sale price to the marketplace (Trendyol). This
 * is a LIVE, IRREVERSIBLE write — the product is offered at the new price on the
 * storefront and Trendyol allows only one price change per barcode per day.
 * Restricted to OWNER/ADMIN (backend enforces; the UI gates as UX only).
 *
 * The marketplace is asynchronous: the endpoint submits the batch then polls a
 * short bounded window. `status: 'SUCCESS'` means the change was confirmed and
 * the local price updated; `status: 'PENDING'` means it was accepted but not
 * confirmed in time (the local price is unchanged — it may still apply upstream).
 * A per-item rejection surfaces as a 422 MARKETPLACE_WRITE_FAILED ApiError.
 */
export async function updatePrice(args: UpdatePriceArgs): Promise<UpdatePriceResponse> {
  const { orgId, storeId, variantId, salePrice } = args;
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/product-pricing/price',
    { params: { path: { orgId, storeId } }, body: { variantId, salePrice } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
