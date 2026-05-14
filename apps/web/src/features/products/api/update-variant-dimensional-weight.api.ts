import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type VariantDimensionalWeightResponse =
  components['schemas']['VariantDimensionalWeightResponse'];

export interface UpdateVariantDimensionalWeightArgs {
  orgId: string;
  storeId: string;
  variantId: string;
  /** Decimal string with up to 2 fractional digits, OR null to clear the override. */
  dimensionalWeight: string | null;
}

export async function updateVariantDimensionalWeight(
  args: UpdateVariantDimensionalWeightArgs,
): Promise<VariantDimensionalWeightResponse> {
  const { orgId, storeId, variantId, dimensionalWeight } = args;
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/products/variants/{variantId}/dimensional-weight',
    {
      params: { path: { orgId, storeId, variantId } },
      body: { dimensionalWeight },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
