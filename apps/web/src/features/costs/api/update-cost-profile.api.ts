import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { CostProfile, UpdateCostProfileInput } from '../types/cost-profile.types';

export interface UpdateCostProfileArgs {
  orgId: string;
  profileId: string;
  body: UpdateCostProfileInput;
}

export async function updateCostProfile(args: UpdateCostProfileArgs): Promise<CostProfile> {
  const { orgId, profileId, body } = args;
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/cost-profiles/{id}',
    {
      params: { path: { orgId, id: profileId } },
      body,
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
