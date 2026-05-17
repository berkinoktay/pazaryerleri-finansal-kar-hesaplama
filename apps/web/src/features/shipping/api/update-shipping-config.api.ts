import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { normalizeShippingConfig } from '../lib/normalize-shipping-config';
import type { ShippingConfig, UpdateShippingConfigInput } from '../types/shipping.types';

/**
 * Updates a store's shipping configuration (OWNER/ADMIN gated on the
 * backend). Returns the freshly applied config including the embedded
 * carrier row when one was selected. Validation failures surface as
 * RFC 7807 `VALIDATION_ERROR` problems with a domain code in
 * `error.problem.code` — primarily `SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT`
 * for the "Trendyol Anlaşmalı without a carrier" case.
 *
 * Response goes through `normalizeShippingConfig` for the same
 * generator-quirk reason explained in get-shipping-config.api.ts.
 */
export async function updateShippingConfig(
  orgId: string,
  storeId: string,
  body: UpdateShippingConfigInput,
): Promise<ShippingConfig> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/shipping-config',
    { params: { path: { orgId, storeId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return normalizeShippingConfig(data);
}
