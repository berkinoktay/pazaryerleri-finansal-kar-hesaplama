import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type BulkUpdateVariantDimensionalWeightResponse =
  components['schemas']['BulkUpdateVariantDimensionalWeightResponse'];

export interface BulkUpdateVariantDimensionalWeightArgs {
  orgId: string;
  storeId: string;
  variantIds: string[];
  /** Decimal string with up to 2 fractional digits, OR null to clear all overrides. */
  dimensionalWeight: string | null;
}

export async function bulkUpdateVariantDimensionalWeight(
  args: BulkUpdateVariantDimensionalWeightArgs,
): Promise<BulkUpdateVariantDimensionalWeightResponse> {
  const { orgId, storeId, variantIds, dimensionalWeight } = args;
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/products/variants/dimensional-weight',
    {
      params: { path: { orgId, storeId } },
      body: { variantIds, dimensionalWeight },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
