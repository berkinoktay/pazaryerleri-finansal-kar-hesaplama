import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { normalizeShippingConfig } from '../lib/normalize-shipping-config';
import type { ShippingConfig } from '../types/shipping.types';

/**
 * Returns the current shipping configuration for a store: the active
 * tariff source (TRENDYOL_CONTRACT vs OWN_CONTRACT) plus the default
 * carrier id and embedded full carrier row. The backend embeds the
 * carrier row so the UI never needs a second round-trip on first
 * render.
 *
 * The wire response runs through `normalizeShippingConfig` because
 * openapi-typescript generates the backend's nullable allOf as
 * `ShippingCarrier & (Record<string, never> | null)` — a type the
 * runtime payload (a populated carrier OR a real null) doesn't fit
 * cleanly. The normalizer is the audited boundary that translates
 * the generated shape into the feature's domain type.
 */
export async function getShippingConfig(orgId: string, storeId: string): Promise<ShippingConfig> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/shipping-config',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return normalizeShippingConfig(data);
}
