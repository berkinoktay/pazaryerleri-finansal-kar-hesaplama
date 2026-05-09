import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { DetachResponse } from '../types/cost-profile.types';

export interface DetachCostProfilesArgs {
  orgId: string;
  profileIds: string[];
  variantIds: string[];
}

export type { DetachResponse };

export async function detachCostProfiles(args: DetachCostProfilesArgs): Promise<DetachResponse> {
  const { orgId, profileIds, variantIds } = args;
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/cost-profile-attachments/detach',
    {
      params: { path: { orgId } },
      body: { profileIds, variantIds },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
