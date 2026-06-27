import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ProfitSettings } from '../types/profit-settings.types';

/**
 * Returns the resolved (default-applied) per-store profit-formula settings:
 * whether the %1 e-ticaret stopajı is subtracted and whether negative net VAT
 * is included in profit. The backend always sends both keys resolved, so the
 * response is the domain shape directly (no wrapper).
 */
export async function getProfitSettings(orgId: string, storeId: string): Promise<ProfitSettings> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/profit-settings',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
