import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type UpdateAdvantageCommissionSourceBody =
  components['schemas']['UpdateAdvantageCommissionSourceBody'];
export type UpdateAdvantageCommissionSourceResponse =
  components['schemas']['UpdateAdvantageCommissionSourceResponse'];

/**
 * PATCH /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/commission-source
 *
 * Pins which Commission Tariff supplies each tier's reduced commission for this
 * Advantage tariff, or clears the pin (`commissionSourceTariffId: null`) to fall back
 * to automatic resolution (the active period). Every tier profit in the detail view is
 * then recomputed from the pinned source. Returns the resolved id.
 */
export async function updateAdvantageCommissionSource(
  orgId: string,
  storeId: string,
  tariffId: string,
  body: UpdateAdvantageCommissionSourceBody,
): Promise<UpdateAdvantageCommissionSourceResponse> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/commission-source',
    { params: { path: { orgId, storeId, tariffId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
