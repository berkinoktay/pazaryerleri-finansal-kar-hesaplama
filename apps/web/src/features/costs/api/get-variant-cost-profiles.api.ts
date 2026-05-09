import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { ListVariantCostProfilesResponse } from '../types/cost-profile.types';

export interface GetVariantCostProfilesArgs {
  orgId: string;
  variantId: string;
}

export async function getVariantCostProfiles(
  args: GetVariantCostProfilesArgs,
): Promise<ListVariantCostProfilesResponse> {
  const { orgId, variantId } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/variants/{variantId}/cost-profiles',
    {
      params: { path: { orgId, variantId } },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
