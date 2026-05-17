import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { OwnShippingTariffRow } from '../types/shipping.types';

/**
 * Returns the tenant-private shipping price table used when a store is
 * on OWN_CONTRACT. V1 always returns `[]` — the Excel upload flow that
 * populates this table is deferred to V2. The endpoint exists so the
 * UI can hit a real route while rendering the "yakında" empty state.
 */
export async function listOwnShippingTariff(
  orgId: string,
  storeId: string,
): Promise<OwnShippingTariffRow[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/own-shipping-tariff',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
