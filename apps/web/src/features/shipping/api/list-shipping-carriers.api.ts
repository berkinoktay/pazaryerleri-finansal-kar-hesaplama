import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ShippingCarrier } from '../types/shipping.types';

/**
 * Returns the global, read-only catalogue of shipping carriers. The
 * endpoint is org-scoped (gated by `requireOrgMembership`) but the
 * underlying data is system-seeded — no per-tenant filtering.
 *
 * `platform` is forwarded as an optional query param when provided.
 * When omitted, the API returns every carrier across all platforms;
 * callers that know the store's platform should pass it so the
 * dropdown stays scoped.
 */
export async function listShippingCarriers(
  orgId: string,
  platform?: 'TRENDYOL' | 'HEPSIBURADA',
): Promise<ShippingCarrier[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/shipping-carriers',
    {
      params: {
        path: { orgId },
        ...(platform !== undefined ? { query: { platform } } : {}),
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
