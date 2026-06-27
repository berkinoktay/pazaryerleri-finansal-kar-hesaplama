import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ProfitSettings, UpdateProfitSettingsInput } from '../types/profit-settings.types';

/**
 * Shallow-merges the provided profit-formula toggles into the store (OWNER/ADMIN
 * gated on the backend). Returns the freshly resolved settings. SNAPSHOT-AT-CREATE:
 * the change only affects orders created afterwards — existing orders are unchanged.
 */
export async function updateProfitSettings(
  orgId: string,
  storeId: string,
  body: UpdateProfitSettingsInput,
): Promise<ProfitSettings> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/profit-settings',
    { params: { path: { orgId, storeId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
