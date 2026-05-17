import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { CarrierTariffs } from '../types/shipping.types';

/**
 * Returns the desi-bazlı (NORMAL lane) tariff rows plus the Barem
 * desteği tier table for a single shipping carrier. Used by the store
 * settings UI to surface the current tariff values inline so a seller
 * can flag discrepancies without leaving the page.
 *
 * The endpoint is org-scoped (membership-gated) but the tariff data is
 * platform-wide reference. Returns 404 when the carrier id is unknown
 * or has been deactivated.
 */
export async function getCarrierTariffs(orgId: string, carrierId: string): Promise<CarrierTariffs> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/shipping-carriers/{carrierId}/tariffs',
    { params: { path: { orgId, carrierId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
